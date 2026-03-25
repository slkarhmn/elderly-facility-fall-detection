#include <TensorFlowLite.h>
#include <Arduino_LSM9DS1.h>
#include <ArduinoBLE.h>
#include <ctype.h>
#include <math.h>

#define ENABLE_TINYML 1

#if ENABLE_TINYML
  #include "model_data.h"
  #include "model_settings.h"
  #include <tensorflow/lite/micro/all_ops_resolver.h>
  #include <tensorflow/lite/micro/micro_interpreter.h>
  #include <tensorflow/lite/schema/schema_generated.h>
#else
  constexpr int kFeatureCount = 24;
  constexpr int kClassCount = 7;
  constexpr int kTrainingSampleRateHz = 50;
  constexpr int kWindowSamples = 100;
  constexpr int kCalibrationWindowTarget = 10;

  const char* kClassLabels[kClassCount] = {
    "walking",
    "stumbling",
    "idle_standing",
    "idle_sitting",
    "upstairs",
    "downstairs",
    "fall"
  };
#endif

#define SAFE_PRINT(x) do { if (Serial) Serial.print(x); } while (0)
#define SAFE_PRINTLN(x) do { if (Serial) Serial.println(x); } while (0)
#define SAFE_PRINT2(x, y) do { if (Serial) Serial.print(x, y); } while (0)
#define SAFE_PRINTLN2(x, y) do { if (Serial) Serial.println(x, y); } while (0)

#define DEVICE_NAME "PATIENT_01"

BLEService fallDetectedService("FF01");

BLEService normalService("19B10000-E8F2-537E-4F6C-D104768A1214");

BLEByteCharacteristic fallAlertCharacteristic(
  "19B10001-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLENotify
);

BLEByteCharacteristic predictionCharacteristic(
  "19B10002-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLENotify
);

BLEByteCharacteristic confidenceCharacteristic(
  "19B10003-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLENotify
);

BLEByteCharacteristic modeCommandCharacteristic(
  "19B10004-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLEWrite
);


enum RuntimeMode {
  MODE_RECORD,
  MODE_CALIBRATE,
  MODE_INFER
};

constexpr int kRecordSampleIntervalMs = 10;
constexpr int kFeatureSampleIntervalMs = 1000 / kTrainingSampleRateHz;
constexpr int kPrimaryAxisCount = 3;

static_assert(kFeatureCount == 24,  "Expected 24 exported features.");
static_assert(kClassCount == 7,   "Expected 7 exported classes.");
static_assert(kTrainingSampleRateHz == 50,  "Expected 50 Hz inference sample rate.");
static_assert(kWindowSamples == 100, "Expected 100 samples per inference window.");
static_assert(kCalibrationWindowTarget == 10,  "Expected 10 calibration windows.");

constexpr int kWalkingClassIndex = 0;
constexpr int kStumblingClassIndex = 1;
constexpr int kIdleStandingClassIndex = 2;
constexpr int kIdleSittingClassIndex = 3;
constexpr int kUpstairsClassIndex = 4;
constexpr int kDownstairsClassIndex = 5;
constexpr int kFallClassIndex = 6;

constexpr int kMagnitudeMeanFeatureIndex = 18;
constexpr int kMagnitudeStdFeatureIndex = 19;

constexpr int kMagnitudeMaxFeatureIndex = 21;
constexpr int kMagnitudeRangeFeatureIndex = 22;
constexpr int kMagnitudeEnergyFeatureIndex = 23;

constexpr float kFallConfidenceThreshold = 0.55f;
constexpr float kFallImpactMagnitudeThresholdG = 2.35f;
constexpr float kFallImpactRangeThresholdG = 1.40f;
constexpr float kPostFallLowMotionStdThresholdG = 0.20f;
constexpr int kFallPersistenceWindows = 2;
constexpr int kPostFallObservationWindows = 2;
constexpr int kFallAlertLatchWindows = 2;

RuntimeMode runtimeMode  = MODE_RECORD;
unsigned long lastSampleTime = 0;
unsigned long inferenceWindowCounter = 0;

float axWindow[kWindowSamples];
float ayWindow[kWindowSamples];
float azWindow[kWindowSamples];
int windowIndex = 0;

bool calibrationReady = false;
int calibrationWindowCount = 0;
float calibrationMean[kFeatureCount];
float calibrationM2[kFeatureCount];
float calibrationStd[kFeatureCount];

int consecutiveFallCandidateWindows = 0;
int postFallObservationCountdown = 0;
int fallAlertLatchCountdown = 0;
unsigned long confirmedFallAlertCount = 0;
unsigned long stumblePredictionCount  = 0;
bool previousFallAlertState = false;

static uint8_t lastAdvertisedStateIndex = 255;

#if ENABLE_TINYML
  constexpr int kTensorArenaSize = 32 * 1024;
  uint8_t tensorArena[kTensorArenaSize];
  const tflite::Model* tfliteModel = nullptr;
  tflite::AllOpsResolver resolver;
  tflite::MicroInterpreter* interpreter = nullptr;
  TfLiteTensor* inputTensor = nullptr;
  TfLiteTensor* outputTensor = nullptr;
#endif

struct InferenceSummary {
  int bestIndex;
  int secondIndex;
  float bestScore;
  float secondScore;
};

struct FallDecision {
  bool candidate;
  bool alertActive;
  bool impactDetected;
  bool lowMotionDetected;
  const char* state;
};

const char* modeName(RuntimeMode mode) {
  switch (mode) {
    case MODE_RECORD: return "record";
    case MODE_CALIBRATE: return "calibrate";
    case MODE_INFER: return "infer";
  }
  return "unknown";
}

const char* labelForIndex(int index) {
  if (index < 0 || index >= kClassCount) return "unknown";
  return kClassLabels[index];
}

bool isStillnessClass(int classIndex) {
  return classIndex == kIdleStandingClassIndex ||
         classIndex == kIdleSittingClassIndex  ||
         classIndex == kFallClassIndex;
}

void printRecordHeader() {
  SAFE_PRINTLN("timestamp_ms,ax,ay,az,gx,gy,gz");
}

void printModeHelp() {
  SAFE_PRINTLN("Commands: r=record, c=calibrate, i=infer, p=status, h=help");
  SAFE_PRINTLN("BLE: write ASCII 'r'/'c'/'i' to modeCommand characteristic");
}

void printRuntimeStatus() {
  SAFE_PRINT("STATUS,mode="); SAFE_PRINT(modeName(runtimeMode));
  SAFE_PRINT(",cal_ready="); SAFE_PRINT(calibrationReady ? 1 : 0);
  SAFE_PRINT(",cal_count="); SAFE_PRINT(calibrationWindowCount);
  SAFE_PRINT(",cal_target="); SAFE_PRINT(kCalibrationWindowTarget);
  SAFE_PRINT(",window_fill="); SAFE_PRINT(windowIndex);
  SAFE_PRINT("/"); SAFE_PRINT(kWindowSamples);
  SAFE_PRINT(",fall_alerts="); SAFE_PRINT(confirmedFallAlertCount);
  SAFE_PRINT(",stumble_predictions="); SAFE_PRINTLN(stumblePredictionCount);
}

void announceMode(bool includeHint = true) {
  SAFE_PRINT("MODE,mode=");        SAFE_PRINT(modeName(runtimeMode));
  SAFE_PRINT(",sample_rate_hz=");  SAFE_PRINT(runtimeMode == MODE_RECORD ? 100 : kTrainingSampleRateHz);
  SAFE_PRINT(",window_samples=");  SAFE_PRINT(kWindowSamples);
  SAFE_PRINT(",cal_ready=");       SAFE_PRINTLN(calibrationReady ? 1 : 0);
  if (!includeHint) return;
  if (runtimeMode == MODE_CALIBRATE) {
    SAFE_PRINTLN("INFO,action=walk_normally_for_calibration");
  } else if (runtimeMode == MODE_INFER && !calibrationReady) {
    SAFE_PRINTLN("INFO,action=calibration_required_before_inference");
  }
}

void resetWindowBuffer() { windowIndex = 0; }

void resetCalibration() {
  calibrationReady       = false;
  calibrationWindowCount = 0;
  for (int i = 0; i < kFeatureCount; ++i) {
    calibrationMean[i] = 0.0f;
    calibrationM2[i]   = 0.0f;
    calibrationStd[i]  = 1.0f;
  }
}

void resetFallPostProcessing() {
  consecutiveFallCandidateWindows = 0;
  postFallObservationCountdown    = 0;
  fallAlertLatchCountdown         = 0;
}

float clampFloat(float value, float low, float high) {
  if (value < low)  return low;
  if (value > high) return high;
  return value;
}

void computeStats(
  const float* values,
  int          count,
  float& mean,
  float& stddev,
  float& minValue,
  float& maxValue,
  float& rangeValue,
  float& energy
) {
  float sum = 0.0f, sumSquares = 0.0f;
  minValue = values[0];
  maxValue = values[0];

  for (int i = 0; i < count; ++i) {
    const float v = values[i];
    sum        += v;
    sumSquares += v * v;
    if (v < minValue) minValue = v;
    if (v > maxValue) maxValue = v;
  }

  mean   = sum / count;
  energy = sumSquares / count;

  float variance = 0.0f;
  for (int i = 0; i < count; ++i) {
    const float delta = values[i] - mean;
    variance += delta * delta;
  }

  stddev     = sqrtf(variance / count);
  rangeValue = maxValue - minValue;
}

void extractFeatureVector(float* outFeatures) {
  float magnitude[kWindowSamples];
  for (int i = 0; i < kWindowSamples; ++i) {
    magnitude[i] = sqrtf(
      axWindow[i] * axWindow[i] +
      ayWindow[i] * ayWindow[i] +
      azWindow[i] * azWindow[i]
    );
  }

  const float* axisBuffers[kPrimaryAxisCount] = { axWindow, ayWindow, azWindow };

  int outIndex = 0;

  for (int axis = 0; axis < kPrimaryAxisCount; ++axis) {
    float mean, stddev, minValue, maxValue, rangeValue, energy;
    computeStats(axisBuffers[axis], kWindowSamples,
                 mean, stddev, minValue, maxValue, rangeValue, energy);
    outFeatures[outIndex++] = mean;
    outFeatures[outIndex++] = stddev;
    outFeatures[outIndex++] = minValue;
    outFeatures[outIndex++] = maxValue;
    outFeatures[outIndex++] = rangeValue;
    outFeatures[outIndex++] = energy;
  }

  float mean, stddev, minValue, maxValue, rangeValue, energy;
  computeStats(magnitude, kWindowSamples,
               mean, stddev, minValue, maxValue, rangeValue, energy);
  outFeatures[outIndex++] = mean;
  outFeatures[outIndex++] = stddev;
  outFeatures[outIndex++] = minValue;
  outFeatures[outIndex++] = maxValue;
  outFeatures[outIndex++] = rangeValue;
  outFeatures[outIndex++] = energy;
}

void updateCalibration(const float* featureVector) {
  calibrationWindowCount++;

  for (int i = 0; i < kFeatureCount; ++i) {
    const float delta   = featureVector[i] - calibrationMean[i];
    calibrationMean[i] += delta / calibrationWindowCount;
    const float delta2  = featureVector[i] - calibrationMean[i];
    calibrationM2[i]   += delta * delta2;
    if (calibrationWindowCount > 1) {
      calibrationStd[i] = sqrtf(calibrationM2[i] / (calibrationWindowCount - 1));
      if (calibrationStd[i] < 1e-6f) calibrationStd[i] = 1.0f;
    }
  }

  if (calibrationWindowCount >= kCalibrationWindowTarget) {
    calibrationReady = true;
  }
}

void applyCalibration(float* featureVector) {
  if (!calibrationReady) return;
  for (int i = 0; i < kFeatureCount; ++i) {
    featureVector[i] = (featureVector[i] - calibrationMean[i]) / calibrationStd[i];
  }
}

void printCalibrationStatus() {
  SAFE_PRINT("CALIBRATION,status=");  SAFE_PRINT(calibrationReady ? "ready" : "collecting");
  SAFE_PRINT(",count=");              SAFE_PRINT(calibrationWindowCount);
  SAFE_PRINT(",target=");             SAFE_PRINT(kCalibrationWindowTarget);
  SAFE_PRINT(",mode=");               SAFE_PRINTLN(modeName(runtimeMode));
}

#if ENABLE_TINYML

bool setupTinyMl() {
  tfliteModel = tflite::GetModel(g_model_tflite);

  if (tfliteModel->version() != TFLITE_SCHEMA_VERSION) {
    SAFE_PRINTLN("ERROR,tflite_schema_mismatch");
    return false;
  }

  static tflite::MicroInterpreter staticInterpreter(
    tfliteModel, resolver, tensorArena, kTensorArenaSize, nullptr, nullptr
  );
  interpreter = &staticInterpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    SAFE_PRINTLN("ERROR,tensor_allocation_failed");
    return false;
  }

  size_t usedBytes = interpreter->arena_used_bytes();
  SAFE_PRINT("INFO,arena_used_bytes=");
  SAFE_PRINT(usedBytes);
  SAFE_PRINT(",arena_total_bytes=");
  SAFE_PRINTLN(kTensorArenaSize);

  inputTensor  = interpreter->input(0);
  outputTensor = interpreter->output(0);

  if (inputTensor->type != kTfLiteInt8 || outputTensor->type != kTfLiteInt8) {
    SAFE_PRINTLN("ERROR,model_quantization_mismatch");
    return false;
  }

  const int inputFeatureCount = inputTensor->dims->data[inputTensor->dims->size - 1];
  const int outputClassCount  = outputTensor->dims->data[outputTensor->dims->size - 1];
  if (inputFeatureCount != kFeatureCount) { SAFE_PRINTLN("ERROR,input_feature_count_mismatch"); return false; }
  if (outputClassCount  != kClassCount)   { SAFE_PRINTLN("ERROR,output_class_count_mismatch");  return false; }

  return true;
}

bool runInference(const float* featureVector, InferenceSummary& summary) {
  summary.bestIndex   = 0;
  summary.secondIndex = 0;
  summary.bestScore   = -1000.0f;
  summary.secondScore = -1000.0f;

  for (int i = 0; i < kFeatureCount; ++i) {
    const float standardized = (featureVector[i] - kGlobalFeatureMean[i]) / kGlobalFeatureStd[i];
    const int32_t quantized  = (int32_t)roundf(standardized / kInputScale) + kInputZeroPoint;
    inputTensor->data.int8[i] = (int8_t)clampFloat((float)quantized, -128.0f, 127.0f);
  }

  if (interpreter->Invoke() != kTfLiteOk) {
    SAFE_PRINTLN("ERROR,inference_failed");
    return false;
  }

  for (int i = 0; i < kClassCount; ++i) {
    const float score = (outputTensor->data.int8[i] - kOutputZeroPoint) * kOutputScale;
    if (score > summary.bestScore) {
      summary.secondScore = summary.bestScore;
      summary.secondIndex = summary.bestIndex;
      summary.bestScore   = score;
      summary.bestIndex   = i;
    } else if (score > summary.secondScore) {
      summary.secondScore = score;
      summary.secondIndex = i;
    }
  }

  return true;
}
#endif

FallDecision updateFallDecision(
  const InferenceSummary& summary,
  const float*            rawFeatureVector
) {
  const float magnitudeStd   = rawFeatureVector[kMagnitudeStdFeatureIndex];
  const float magnitudeMax   = rawFeatureVector[kMagnitudeMaxFeatureIndex];
  const float magnitudeRange = rawFeatureVector[kMagnitudeRangeFeatureIndex];

  FallDecision decision;

  decision.impactDetected =
    magnitudeMax   >= kFallImpactMagnitudeThresholdG ||
    magnitudeRange >= kFallImpactRangeThresholdG;

  decision.lowMotionDetected = magnitudeStd <= kPostFallLowMotionStdThresholdG;

  decision.candidate =
    summary.bestIndex == kFallClassIndex          &&
    summary.bestScore >= kFallConfidenceThreshold &&
    decision.impactDetected;

  decision.alertActive = false;
  decision.state       = "none";

  if (summary.bestIndex == kStumblingClassIndex) stumblePredictionCount++;

  const bool alertWasLatched = fallAlertLatchCountdown > 0;
  if (alertWasLatched) fallAlertLatchCountdown--;

  const bool wasObservingAfterCandidate = postFallObservationCountdown > 0;

  if (decision.candidate) {
    consecutiveFallCandidateWindows++;
    postFallObservationCountdown = kPostFallObservationWindows;
  } else {
    consecutiveFallCandidateWindows = 0;
    if (postFallObservationCountdown > 0) postFallObservationCountdown--;
  }

  const bool persistenceConfirmed =
    decision.candidate &&
    consecutiveFallCandidateWindows >= kFallPersistenceWindows;

  const bool lowMotionConfirmed =
    wasObservingAfterCandidate &&
    decision.lowMotionDetected &&
    isStillnessClass(summary.bestIndex);

  if (persistenceConfirmed || lowMotionConfirmed) {
    decision.alertActive            = true;
    decision.state                  = "alert";
    fallAlertLatchCountdown         = kFallAlertLatchWindows;
    postFallObservationCountdown    = 0;
    consecutiveFallCandidateWindows = 0;
    confirmedFallAlertCount++;

  } else if (alertWasLatched || fallAlertLatchCountdown > 0) {
    decision.alertActive = true;
    decision.state       = "alert";

  } else if (decision.candidate || postFallObservationCountdown > 0) {
    decision.state = "pending";
  }

  return decision;
}

void updatePassiveStateAdvertisement(uint8_t stateIndex, bool alertActive) {
  if (stateIndex == lastAdvertisedStateIndex) return;
  lastAdvertisedStateIndex = stateIndex;

  BLE.stopAdvertise();

  if (alertActive) {
    BLE.setAdvertisedService(fallDetectedService); 
  } else {
    BLE.setAdvertisedService(normalService);
  }

  uint8_t manufacturerData[3] = { 0xFF, 0xFF, stateIndex };
  BLE.setManufacturerData(manufacturerData, 3);

  BLE.advertise();

  SAFE_PRINT("BLE_PASSIVE,state_index=");
  SAFE_PRINT(stateIndex);
  SAFE_PRINT(",label=");
  SAFE_PRINTLN(labelForIndex(stateIndex));
}

void updatePassiveFallAdvertisement(bool alertActive) {
  static bool lastPassiveAlertState = false;
  if (alertActive == lastPassiveAlertState) return;
  lastPassiveAlertState = alertActive;

  BLE.stopAdvertise();

  if (alertActive) {
    BLE.setAdvertisedService(fallDetectedService);
    SAFE_PRINTLN("BLE_PASSIVE,uuid=FF01,state=fall_alert");
  } else {
    BLE.setAdvertisedService(normalService);
    SAFE_PRINTLN("BLE_PASSIVE,uuid=19B10000,state=normal");
  }

  BLE.advertise();
}

void updateBleCharacteristics(
  const InferenceSummary& summary,
  const FallDecision&     decision
) {
  if (decision.alertActive != previousFallAlertState) {
    fallAlertCharacteristic.writeValue(decision.alertActive ? (uint8_t)1 : (uint8_t)0);
    previousFallAlertState = decision.alertActive;
  }

  predictionCharacteristic.writeValue((uint8_t)summary.bestIndex);

  const uint8_t confByte = (uint8_t)clampFloat(summary.bestScore * 100.0f, 0.0f, 100.0f);
  confidenceCharacteristic.writeValue(confByte);
}

void publishFallState(
  const InferenceSummary& summary,
  const FallDecision&     decision
) {
  updateBleCharacteristics(summary, decision);
  updatePassiveFallAdvertisement(decision.alertActive);
  updatePassiveStateAdvertisement((uint8_t)summary.bestIndex, decision.alertActive);
}

void applyCommand(char command) {
  command = (char)tolower(command);

  if (command == 'r') {
    runtimeMode = MODE_RECORD;
    resetWindowBuffer();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    updatePassiveFallAdvertisement(false);
    announceMode(false);
    printRecordHeader();

  } else if (command == 'c') {
    runtimeMode = MODE_CALIBRATE;
    resetWindowBuffer();
    resetCalibration();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    updatePassiveFallAdvertisement(false);
    announceMode();

  } else if (command == 'i') {
    if (!calibrationReady) {
      SAFE_PRINTLN("WARN,infer_blocked_calibration_required");
      return;
    }
    runtimeMode = MODE_INFER;
    resetWindowBuffer();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    announceMode();

  } else if (command == 'p') {
    printRuntimeStatus();
    printCalibrationStatus();

  } else if (command == 'h') {
    printModeHelp();
    printRuntimeStatus();

  } else if (command == 'f') {
    updatePassiveFallAdvertisement(true);
    fallAlertCharacteristic.writeValue((uint8_t)1);
    previousFallAlertState = true;
    SAFE_PRINTLN("DEBUG,simulated_fall_alert=ON");

  } else if (command == 'x') {
    updatePassiveFallAdvertisement(false);
    fallAlertCharacteristic.writeValue((uint8_t)0);
    previousFallAlertState = false;
    SAFE_PRINTLN("DEBUG,simulated_fall_alert=OFF");
  }
}

void handleSerialCommands() {
  if (!Serial.available()) return;
  applyCommand((char)Serial.read());
}

void handleBleCommands() {
  if (!modeCommandCharacteristic.written()) return;
  const uint8_t raw = modeCommandCharacteristic.value();
  if (raw == 0) return;
  applyCommand((char)raw);
}

bool setupBle() {
  if (!BLE.begin()) {
    SAFE_PRINTLN("ERROR,ble_init_failed");
    return false;
  }

  BLE.setLocalName(DEVICE_NAME);

  normalService.addCharacteristic(fallAlertCharacteristic);
  normalService.addCharacteristic(predictionCharacteristic);
  normalService.addCharacteristic(confidenceCharacteristic);
  normalService.addCharacteristic(modeCommandCharacteristic);

  BLE.addService(normalService);
  BLE.addService(fallDetectedService);

  fallAlertCharacteristic.writeValue((uint8_t)0);
  predictionCharacteristic.writeValue((uint8_t)255);
  confidenceCharacteristic.writeValue((uint8_t)0);
  modeCommandCharacteristic.writeValue((uint8_t)0);

  BLE.setAdvertisedService(normalService);
  BLE.advertise();

  SAFE_PRINT("INFO,ble=advertising,name=");
  SAFE_PRINT(DEVICE_NAME);
  SAFE_PRINTLN(",passive_uuid=181C");
  return true;
}

void printInferenceSummary(
  const InferenceSummary& summary,
  const FallDecision&     decision,
  const float*            rawFeatureVector
) {
  SAFE_PRINT("INFER,mode=");             SAFE_PRINT(modeName(runtimeMode));
  SAFE_PRINT(",window=");                SAFE_PRINT(inferenceWindowCounter);
  SAFE_PRINT(",pred=");                  SAFE_PRINT(labelForIndex(summary.bestIndex));
  SAFE_PRINT(",conf=");                  SAFE_PRINT2(summary.bestScore, 4);
  SAFE_PRINT(",top2=");                  SAFE_PRINT(labelForIndex(summary.secondIndex));
  SAFE_PRINT(",top2_conf=");             SAFE_PRINT2(summary.secondScore, 4);
  SAFE_PRINT(",fall_state=");            SAFE_PRINT(decision.state);
  SAFE_PRINT(",fall_candidate=");        SAFE_PRINT(decision.candidate ? 1 : 0);
  SAFE_PRINT(",fall_alert=");            SAFE_PRINT(decision.alertActive ? 1 : 0);
  SAFE_PRINT(",impact=");                SAFE_PRINT(decision.impactDetected ? 1 : 0);
  SAFE_PRINT(",low_motion=");            SAFE_PRINT(decision.lowMotionDetected ? 1 : 0);
  SAFE_PRINT(",mag_mean=");              SAFE_PRINT2(rawFeatureVector[kMagnitudeMeanFeatureIndex], 4);
  SAFE_PRINT(",mag_std=");               SAFE_PRINT2(rawFeatureVector[kMagnitudeStdFeatureIndex], 4);
  SAFE_PRINT(",mag_max=");               SAFE_PRINT2(rawFeatureVector[kMagnitudeMaxFeatureIndex], 4);
  SAFE_PRINT(",mag_range=");             SAFE_PRINT2(rawFeatureVector[kMagnitudeRangeFeatureIndex], 4);
  SAFE_PRINT(",mag_energy=");            SAFE_PRINT2(rawFeatureVector[kMagnitudeEnergyFeatureIndex], 4);
  SAFE_PRINT(",cal_ready=");             SAFE_PRINT(calibrationReady ? 1 : 0);
  SAFE_PRINT(",cal_count=");             SAFE_PRINT(calibrationWindowCount);
  SAFE_PRINT(",fall_alerts=");           SAFE_PRINT(confirmedFallAlertCount);
  SAFE_PRINT(",stumble_predictions=");   SAFE_PRINTLN(stumblePredictionCount);
}

int activeSampleIntervalMs() {
  return runtimeMode == MODE_RECORD ? kRecordSampleIntervalMs : kFeatureSampleIntervalMs;
}

void appendMotionSample(float ax, float ay, float az) {
  if (windowIndex >= kWindowSamples) return;
  axWindow[windowIndex] = ax;
  ayWindow[windowIndex] = ay;
  azWindow[windowIndex] = az;
  windowIndex++;
}

void processWindowIfReady() {
  if (windowIndex < kWindowSamples) return;

  static float rawFeatureVector[kFeatureCount];
  static float modelFeatureVector[kFeatureCount];

  extractFeatureVector(rawFeatureVector);

  if (runtimeMode == MODE_CALIBRATE) {
    updateCalibration(rawFeatureVector);

    SAFE_PRINT("CALIBRATION,progress="); SAFE_PRINT(calibrationWindowCount);
    SAFE_PRINT(",target=");              SAFE_PRINT(kCalibrationWindowTarget);
    SAFE_PRINT(",ready=");               SAFE_PRINTLN(calibrationReady ? 1 : 0);

    if (calibrationReady) {
      SAFE_PRINTLN("CALIBRATION,status=complete");
      printCalibrationStatus();
      runtimeMode = MODE_INFER;
      resetWindowBuffer();
      resetFallPostProcessing();
      inferenceWindowCounter = 0;
      delay(50);
      announceMode();
    }

  } else if (runtimeMode == MODE_INFER) {
    if (!calibrationReady) {
      SAFE_PRINTLN("INFO,action=calibration_required_before_inference");
    } else {
      for (int i = 0; i < kFeatureCount; ++i) modelFeatureVector[i] = rawFeatureVector[i];
      applyCalibration(modelFeatureVector);

      inferenceWindowCounter++;

#if ENABLE_TINYML
      InferenceSummary summary;
      if (runInference(modelFeatureVector, summary)) {
        const FallDecision decision = updateFallDecision(summary, rawFeatureVector);
        printInferenceSummary(summary, decision, rawFeatureVector);
        publishFallState(summary, decision);
      }
#else
      SAFE_PRINTLN("INFERENCE_DISABLED,build_with_ENABLE_TINYML=1");
#endif
    }
  }

  resetWindowBuffer();
}

void setup() {
  Serial.begin(115200);

  pinMode(LED_BUILTIN, OUTPUT);

  if (!IMU.begin()) {
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH); delay(100);
      digitalWrite(LED_BUILTIN, LOW);  delay(100);
    }
  }

  if (!setupBle()) {
    SAFE_PRINTLN("WARN,ble_unavailable_continuing_without_ble");
  }

  resetCalibration();
  resetFallPostProcessing();

  printModeHelp();
  announceMode(false);
  printRuntimeStatus();
  printRecordHeader();

#if ENABLE_TINYML
  if (!setupTinyMl()) {
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH); delay(500);
      digitalWrite(LED_BUILTIN, LOW);  delay(500);
    }
  }
  SAFE_PRINTLN("INFO,model=enabled");
#else
  SAFE_PRINTLN("INFO,model=disabled_enable_tinyml_to_infer");
#endif
}

void loop() {
  BLE.poll();

  BLEDevice central = BLE.central();
  digitalWrite(LED_BUILTIN, (central && central.connected()) ? HIGH : LOW);

  handleSerialCommands();
  handleBleCommands();

  const unsigned long now = millis();
  if (now - lastSampleTime < (unsigned long)activeSampleIntervalMs()) return;
  lastSampleTime = now;

  float ax, ay, az;
  float gx, gy, gz;

  const bool accelReady = IMU.accelerationAvailable();
  const bool gyroReady  = IMU.gyroscopeAvailable();

  if (!accelReady) return;

  IMU.readAcceleration(ax, ay, az);

  if (runtimeMode == MODE_RECORD) {
    if (!gyroReady) return;
    IMU.readGyroscope(gx, gy, gz);

    SAFE_PRINT(now);     SAFE_PRINT(",");
    SAFE_PRINT2(ax, 4);  SAFE_PRINT(",");
    SAFE_PRINT2(ay, 4);  SAFE_PRINT(",");
    SAFE_PRINT2(az, 4);  SAFE_PRINT(",");
    SAFE_PRINT2(gx, 4);  SAFE_PRINT(",");
    SAFE_PRINT2(gy, 4);  SAFE_PRINT(",");
    SAFE_PRINTLN2(gz, 4);
    return;
  }

  appendMotionSample(ax, ay, az);
  processWindowIfReady();
}
