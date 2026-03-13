#include <Arduino_LSM9DS1.h>
#include <ctype.h>
#include <math.h>

#define ENABLE_TINYML 1

#if ENABLE_TINYML
#include "model_data.h"
#include "model_settings.h"
#include <TensorFlowLite.h>
#include <tensorflow/lite/micro/all_ops_resolver.h>
#include <tensorflow/lite/micro/micro_interpreter.h>
#include <tensorflow/lite/schema/schema_generated.h>
#include <tensorflow/lite/version.h>
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

enum RuntimeMode {
  MODE_RECORD,
  MODE_CALIBRATE,
  MODE_INFER
};

constexpr int kRecordSampleIntervalMs = 10;  // 100 Hz
constexpr int kFeatureSampleIntervalMs = 1000 / kTrainingSampleRateHz;
constexpr int kPrimaryAxisCount = 3;
constexpr unsigned long kSerialStartupWaitMs = 3000;

// These checks keep the embedded runtime aligned with the frozen exported model.
static_assert(kFeatureCount == 24, "Expected 24 exported features.");
static_assert(kClassCount == 7, "Expected 7 exported classes.");
static_assert(kTrainingSampleRateHz == 50, "Expected 50 Hz inference sample rate.");
static_assert(kWindowSamples == 100, "Expected 100 samples per inference window.");
static_assert(kCalibrationWindowTarget == 10, "Expected 10 calibration windows.");

// Frozen class order from the exported model.
constexpr int kWalkingClassIndex = 0;
constexpr int kStumblingClassIndex = 1;
constexpr int kIdleStandingClassIndex = 2;
constexpr int kIdleSittingClassIndex = 3;
constexpr int kUpstairsClassIndex = 4;
constexpr int kDownstairsClassIndex = 5;
constexpr int kFallClassIndex = 6;

// Frozen feature order from the Python preprocessing pipeline.
constexpr int kMagnitudeMeanFeatureIndex = 18;
constexpr int kMagnitudeStdFeatureIndex = 19;
constexpr int kMagnitudeMinFeatureIndex = 20;
constexpr int kMagnitudeMaxFeatureIndex = 21;
constexpr int kMagnitudeRangeFeatureIndex = 22;
constexpr int kMagnitudeEnergyFeatureIndex = 23;

// Tunable fall-confirmation thresholds. This is post-processing only.
constexpr float kFallConfidenceThreshold = 0.55f;
constexpr float kFallImpactMagnitudeThresholdG = 2.35f;
constexpr float kFallImpactRangeThresholdG = 1.40f;
constexpr float kPostFallLowMotionStdThresholdG = 0.20f;
constexpr int kFallPersistenceWindows = 2;
constexpr int kPostFallObservationWindows = 2;
constexpr int kFallAlertLatchWindows = 2;

RuntimeMode runtimeMode = MODE_RECORD;
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
unsigned long stumblePredictionCount = 0;

#if ENABLE_TINYML
constexpr int kTensorArenaSize = 8 * 1024;
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
         classIndex == kIdleSittingClassIndex ||
         classIndex == kFallClassIndex;
}

void printRecordHeader() {
  Serial.println("timestamp_ms,ax,ay,az,gx,gy,gz");
}

void printModeHelp() {
  Serial.println("Commands: r=record, c=calibrate, i=infer, p=status, h=help");
}

void printRuntimeStatus() {
  Serial.print("STATUS,mode=");
  Serial.print(modeName(runtimeMode));
  Serial.print(",cal_ready=");
  Serial.print(calibrationReady ? 1 : 0);
  Serial.print(",cal_count=");
  Serial.print(calibrationWindowCount);
  Serial.print(",cal_target=");
  Serial.print(kCalibrationWindowTarget);
  Serial.print(",window_fill=");
  Serial.print(windowIndex);
  Serial.print("/");
  Serial.print(kWindowSamples);
  Serial.print(",fall_alerts=");
  Serial.print(confirmedFallAlertCount);
  Serial.print(",stumble_predictions=");
  Serial.println(stumblePredictionCount);
}

void announceMode(bool includeHint = true) {
  Serial.print("MODE,mode=");
  Serial.print(modeName(runtimeMode));
  Serial.print(",sample_rate_hz=");
  Serial.print(runtimeMode == MODE_RECORD ? 100 : kTrainingSampleRateHz);
  Serial.print(",window_samples=");
  Serial.print(kWindowSamples);
  Serial.print(",cal_ready=");
  Serial.println(calibrationReady ? 1 : 0);

  if (!includeHint) return;
  if (runtimeMode == MODE_CALIBRATE) {
    Serial.println("INFO,action=walk_normally_for_calibration");
  } else if (runtimeMode == MODE_INFER && !calibrationReady) {
    Serial.println("INFO,action=calibration_required_before_inference");
  }
}

void resetWindowBuffer() {
  windowIndex = 0;
}

void resetCalibration() {
  calibrationReady = false;
  calibrationWindowCount = 0;
  for (int i = 0; i < kFeatureCount; ++i) {
    calibrationMean[i] = 0.0f;
    calibrationM2[i] = 0.0f;
    calibrationStd[i] = 1.0f;
  }
}

void resetFallPostProcessing() {
  consecutiveFallCandidateWindows = 0;
  postFallObservationCountdown = 0;
  fallAlertLatchCountdown = 0;
}

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

void computeStats(const float* values, int count, float& mean, float& stddev, float& minValue, float& maxValue, float& rangeValue, float& energy) {
  float sum = 0.0f;
  float sumSquares = 0.0f;
  minValue = values[0];
  maxValue = values[0];
  for (int i = 0; i < count; ++i) {
    const float value = values[i];
    sum += value;
    sumSquares += value * value;
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
  }
  mean = sum / count;
  energy = sumSquares / count;
  float variance = 0.0f;
  for (int i = 0; i < count; ++i) {
    const float delta = values[i] - mean;
    variance += delta * delta;
  }
  stddev = sqrtf(variance / count);
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

  const float* axisBuffers[kPrimaryAxisCount] = {axWindow, ayWindow, azWindow};
  int outIndex = 0;
  for (int axis = 0; axis < kPrimaryAxisCount; ++axis) {
    float mean, stddev, minValue, maxValue, rangeValue, energy;
    computeStats(axisBuffers[axis], kWindowSamples, mean, stddev, minValue, maxValue, rangeValue, energy);
    outFeatures[outIndex++] = mean;
    outFeatures[outIndex++] = stddev;
    outFeatures[outIndex++] = minValue;
    outFeatures[outIndex++] = maxValue;
    outFeatures[outIndex++] = rangeValue;
    outFeatures[outIndex++] = energy;
  }

  float mean, stddev, minValue, maxValue, rangeValue, energy;
  computeStats(magnitude, kWindowSamples, mean, stddev, minValue, maxValue, rangeValue, energy);
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
    const float delta = featureVector[i] - calibrationMean[i];
    calibrationMean[i] += delta / calibrationWindowCount;
    const float delta2 = featureVector[i] - calibrationMean[i];
    calibrationM2[i] += delta * delta2;
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
    // Embedded inference mirrors Python personalization:
    // 1) normalize by user walking baseline, 2) normalize by global training scaler.
    featureVector[i] = (featureVector[i] - calibrationMean[i]) / calibrationStd[i];
  }
}

void printCalibrationStatus() {
  Serial.print("CALIBRATION,status=");
  Serial.print(calibrationReady ? "ready" : "collecting");
  Serial.print(",count=");
  Serial.print(calibrationWindowCount);
  Serial.print(",target=");
  Serial.print(kCalibrationWindowTarget);
  Serial.print(",mode=");
  Serial.println(modeName(runtimeMode));
}

#if ENABLE_TINYML
bool setupTinyMl() {
  tfliteModel = tflite::GetModel(g_model_tflite);
  if (tfliteModel->version() != TFLITE_SCHEMA_VERSION) {
    Serial.println("ERROR,tflite_schema_mismatch");
    return false;
  }

  static tflite::MicroInterpreter staticInterpreter(
    tfliteModel,
    resolver,
    tensorArena,
    kTensorArenaSize
  );
  interpreter = &staticInterpreter;
  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("ERROR,tensor_allocation_failed");
    return false;
  }

  inputTensor = interpreter->input(0);
  outputTensor = interpreter->output(0);

  if (inputTensor->type != kTfLiteInt8 || outputTensor->type != kTfLiteInt8) {
    Serial.println("ERROR,model_quantization_mismatch");
    return false;
  }

  const int inputFeatureCount = inputTensor->dims->data[inputTensor->dims->size - 1];
  const int outputClassCount = outputTensor->dims->data[outputTensor->dims->size - 1];
  if (inputFeatureCount != kFeatureCount) {
    Serial.println("ERROR,input_feature_count_mismatch");
    return false;
  }
  if (outputClassCount != kClassCount) {
    Serial.println("ERROR,output_class_count_mismatch");
    return false;
  }
  return true;
}

bool runInference(const float* featureVector, InferenceSummary& summary) {
  summary.bestIndex = 0;
  summary.secondIndex = 0;
  summary.bestScore = -1000.0f;
  summary.secondScore = -1000.0f;

  for (int i = 0; i < kFeatureCount; ++i) {
    const float standardized = (featureVector[i] - kGlobalFeatureMean[i]) / kGlobalFeatureStd[i];
    const int32_t quantized = (int32_t)roundf(standardized / kInputScale) + kInputZeroPoint;
    inputTensor->data.int8[i] = (int8_t)clampFloat((float)quantized, -128.0f, 127.0f);
  }

  if (interpreter->Invoke() != kTfLiteOk) {
    Serial.println("ERROR,inference_failed");
    return false;
  }

  for (int i = 0; i < kClassCount; ++i) {
    const float score = (outputTensor->data.int8[i] - kOutputZeroPoint) * kOutputScale;
    if (score > summary.bestScore) {
      summary.secondScore = summary.bestScore;
      summary.secondIndex = summary.bestIndex;
      summary.bestScore = score;
      summary.bestIndex = i;
    } else if (score > summary.secondScore) {
      summary.secondScore = score;
      summary.secondIndex = i;
    }
  }
  return true;
}
#endif

FallDecision updateFallDecision(const InferenceSummary& summary, const float* rawFeatureVector) {
  const float magnitudeStd = rawFeatureVector[kMagnitudeStdFeatureIndex];
  const float magnitudeMax = rawFeatureVector[kMagnitudeMaxFeatureIndex];
  const float magnitudeRange = rawFeatureVector[kMagnitudeRangeFeatureIndex];

  FallDecision decision;
  decision.impactDetected =
    magnitudeMax >= kFallImpactMagnitudeThresholdG ||
    magnitudeRange >= kFallImpactRangeThresholdG;
  decision.lowMotionDetected = magnitudeStd <= kPostFallLowMotionStdThresholdG;
  decision.candidate =
    summary.bestIndex == kFallClassIndex &&
    summary.bestScore >= kFallConfidenceThreshold &&
    decision.impactDetected;
  decision.alertActive = false;
  decision.state = "none";

  if (summary.bestIndex == kStumblingClassIndex) {
    stumblePredictionCount++;
  }

  const bool alertWasLatched = fallAlertLatchCountdown > 0;
  if (alertWasLatched) {
    fallAlertLatchCountdown--;
  }

  const bool wasObservingAfterCandidate = postFallObservationCountdown > 0;
  if (decision.candidate) {
    consecutiveFallCandidateWindows++;
    postFallObservationCountdown = kPostFallObservationWindows;
  } else {
    consecutiveFallCandidateWindows = 0;
    if (postFallObservationCountdown > 0) {
      postFallObservationCountdown--;
    }
  }

  const bool persistenceConfirmed =
    decision.candidate && consecutiveFallCandidateWindows >= kFallPersistenceWindows;
  const bool lowMotionConfirmed =
    wasObservingAfterCandidate &&
    decision.lowMotionDetected &&
    isStillnessClass(summary.bestIndex);

  if (persistenceConfirmed || lowMotionConfirmed) {
    decision.alertActive = true;
    decision.state = "alert";
    fallAlertLatchCountdown = kFallAlertLatchWindows;
    postFallObservationCountdown = 0;
    consecutiveFallCandidateWindows = 0;
    confirmedFallAlertCount++;
  } else if (alertWasLatched || fallAlertLatchCountdown > 0) {
    decision.alertActive = true;
    decision.state = "alert";
  } else if (decision.candidate || postFallObservationCountdown > 0) {
    decision.state = "pending";
  }

  return decision;
}

void printInferenceSummary(
  const InferenceSummary& summary,
  const FallDecision& decision,
  const float* rawFeatureVector
) {
  Serial.print("INFER,mode=");
  Serial.print(modeName(runtimeMode));
  Serial.print(",window=");
  Serial.print(inferenceWindowCounter);
  Serial.print(",pred=");
  Serial.print(labelForIndex(summary.bestIndex));
  Serial.print(",conf=");
  Serial.print(summary.bestScore, 4);
  Serial.print(",top2=");
  Serial.print(labelForIndex(summary.secondIndex));
  Serial.print(",top2_conf=");
  Serial.print(summary.secondScore, 4);
  Serial.print(",fall_state=");
  Serial.print(decision.state);
  Serial.print(",fall_candidate=");
  Serial.print(decision.candidate ? 1 : 0);
  Serial.print(",fall_alert=");
  Serial.print(decision.alertActive ? 1 : 0);
  Serial.print(",impact=");
  Serial.print(decision.impactDetected ? 1 : 0);
  Serial.print(",low_motion=");
  Serial.print(decision.lowMotionDetected ? 1 : 0);
  Serial.print(",mag_mean=");
  Serial.print(rawFeatureVector[kMagnitudeMeanFeatureIndex], 4);
  Serial.print(",mag_std=");
  Serial.print(rawFeatureVector[kMagnitudeStdFeatureIndex], 4);
  Serial.print(",mag_max=");
  Serial.print(rawFeatureVector[kMagnitudeMaxFeatureIndex], 4);
  Serial.print(",mag_range=");
  Serial.print(rawFeatureVector[kMagnitudeRangeFeatureIndex], 4);
  Serial.print(",mag_energy=");
  Serial.print(rawFeatureVector[kMagnitudeEnergyFeatureIndex], 4);
  Serial.print(",cal_ready=");
  Serial.print(calibrationReady ? 1 : 0);
  Serial.print(",cal_count=");
  Serial.print(calibrationWindowCount);
  Serial.print(",fall_alerts=");
  Serial.print(confirmedFallAlertCount);
  Serial.print(",stumble_predictions=");
  Serial.println(stumblePredictionCount);
}

void handleSerialCommands() {
  if (!Serial.available()) return;
  const char command = (char)tolower(Serial.read());
  if (command == 'r') {
    runtimeMode = MODE_RECORD;
    resetWindowBuffer();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    announceMode(false);
    printRecordHeader();
  } else if (command == 'c') {
    runtimeMode = MODE_CALIBRATE;
    resetWindowBuffer();
    resetCalibration();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    announceMode();
  } else if (command == 'i') {
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
  }
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
  float rawFeatureVector[kFeatureCount];
  extractFeatureVector(rawFeatureVector);

  if (runtimeMode == MODE_CALIBRATE) {
    updateCalibration(rawFeatureVector);
    Serial.print("CALIBRATION,progress=");
    Serial.print(calibrationWindowCount);
    Serial.print(",target=");
    Serial.print(kCalibrationWindowTarget);
    Serial.print(",ready=");
    Serial.println(calibrationReady ? 1 : 0);
    if (calibrationReady) {
      Serial.println("CALIBRATION,status=complete");
      printCalibrationStatus();
    }
  } else if (runtimeMode == MODE_INFER) {
    if (!calibrationReady) {
      Serial.println("INFO,action=calibration_required_before_inference");
    } else {
      float modelFeatureVector[kFeatureCount];
      for (int i = 0; i < kFeatureCount; ++i) {
        modelFeatureVector[i] = rawFeatureVector[i];
      }

      applyCalibration(modelFeatureVector);
      inferenceWindowCounter++;
#if ENABLE_TINYML
      InferenceSummary summary;
      if (runInference(modelFeatureVector, summary)) {
        const FallDecision decision = updateFallDecision(summary, rawFeatureVector);
        printInferenceSummary(summary, decision, rawFeatureVector);
      }
#else
      Serial.println("INFERENCE_DISABLED,build_with_ENABLE_TINYML=1");
#endif
    }
  }

  resetWindowBuffer();
}

void setup() {
  Serial.begin(115200);
  const unsigned long serialWaitStart = millis();
  while (!Serial && (millis() - serialWaitStart) < kSerialStartupWaitMs) {}
  if (!IMU.begin()) {
    Serial.println("ERROR,imu_init_failed");
    while (1);
  }

  resetCalibration();
  resetFallPostProcessing();
  printModeHelp();
  announceMode(false);
  printRuntimeStatus();
  printRecordHeader();
#if ENABLE_TINYML
  if (!setupTinyMl()) {
    while (1);
  }
  Serial.println("INFO,model=enabled");
#else
  Serial.println("INFO,model=disabled_enable_tinyml_to_infer");
#endif
}

void loop() {
  handleSerialCommands();

  const unsigned long now = millis();
  if (now - lastSampleTime < (unsigned long)activeSampleIntervalMs()) {
    return;
  }
  lastSampleTime = now;

  float ax, ay, az, gx, gy, gz;
  const bool accelReady = IMU.accelerationAvailable();
  const bool gyroReady = IMU.gyroscopeAvailable();
  if (!accelReady) return;

  IMU.readAcceleration(ax, ay, az);

  if (runtimeMode == MODE_RECORD) {
    if (!gyroReady) return;
    IMU.readGyroscope(gx, gy, gz);
    Serial.print(now);   Serial.print(",");
    Serial.print(ax, 4); Serial.print(",");
    Serial.print(ay, 4); Serial.print(",");
    Serial.print(az, 4); Serial.print(",");
    Serial.print(gx, 4); Serial.print(",");
    Serial.print(gy, 4); Serial.print(",");
    Serial.println(gz, 4);
    return;
  }

  appendMotionSample(ax, ay, az);
  processWindowIfReady();
}