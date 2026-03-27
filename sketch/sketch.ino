#include <TensorFlowLite.h>
#include <Arduino_LSM9DS1.h>
#include <ArduinoBLE.h>
#include <ctype.h>
#include <math.h>

//set to 1 to use model and 0 to use the test values 
#define ENABLE_TINYML 1

#if ENABLE_TINYML
  #include "model_data.h"
  #include "model_settings.h" 
  #include <tensorflow/lite/micro/all_ops_resolver.h>
  #include <tensorflow/lite/micro/micro_interpreter.h>
  #include <tensorflow/lite/schema/schema_generated.h>

  constexpr int kTensorArenaSize = 32 * 1024;
  uint8_t tensorArena[kTensorArenaSize];
  const tflite::Model* tfliteModel = nullptr;
  tflite::AllOpsResolver resolver;
  tflite::MicroInterpreter* interpreter = nullptr;
  TfLiteTensor* inputTensor = nullptr;
  TfLiteTensor* outputTensor = nullptr;
#else
  constexpr int kFeatureCount = 24;
  constexpr int kClassCount = 7;
  constexpr int kTrainingSampleRateHz = 50;
  constexpr int kWindowSamples = 100;
  constexpr int kCalibrationWindowTarget = 10;

  const char* kClassLabels[kClassCount] = {"walking", "stumbling", "idle_standing", "idle_sitting", "upstairs", "downstairs", "fall"};
#endif


// macros to check if on serial or not before printing. if on ble, then nothing is printed. avoids wasting energy.
#define SAFE_PRINT_MACRO(x) do { if (Serial) Serial.print(x); } while (0)
#define SAFE_PRINTLN_MACRO(x) do { if (Serial) Serial.println(x); } while (0)
#define SAFE_PRINT_WITH_DECIMAL_MACRO(x, y) do { if (Serial) Serial.print(x, y); } while (0)
#define SAFE_PRINTLN_WITH_DECIMAL_MACRO(x, y) do { if (Serial) Serial.println(x, y); } while (0)

#define DEVICE_NAME "PATIENT_01"

// checks to make sure that values are passed over from model_settings.h
static_assert(kFeatureCount == 24, "ERROR: Expected 24 exported features.");
static_assert(kClassCount == 7, "ERROR: Expected 7 exported classes.");
static_assert(kTrainingSampleRateHz == 50, "ERROR: Expected 50 Hz inference sample rate.");
static_assert(kWindowSamples == 100, "ERROR: Expected 100 samples per inference window.");
static_assert(kCalibrationWindowTarget == 10, "ERROR: Expected 10 calibration windows.");


BLEService fallDetectedService("FF01"); // this service is to advertise when a fall is detected 
// used so that a passive scanner can pick up on fall alerts instead of actively scanning for falls all the time

BLEService normalService("19B10000-E8F2-537E-4F6C-D104768A1214");

// 1 if fall alert active, otherwise 0
BLEByteCharacteristic fallAlertCharacteristic(
  "19B10001-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLENotify
);

// index of the predicted activity class
BLEByteCharacteristic predictionCharacteristic(
  "19B10002-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLENotify
);

// model prediction confidence from 0 to 100
BLEByteCharacteristic confidenceCharacteristic(
  "19B10003-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLENotify
);

// rceives ascii character to switch between modes 
BLEByteCharacteristic modeCommandCharacteristic(
  "19B10004-E8F2-537E-4F6C-D104768A1214",
  BLERead | BLEWrite
);

// the modes the board can run in
enum RuntimeMode {
  MODE_RECORD, // index 0, recording all data, activated with 'r'
  MODE_CALIBRATE, // index 1, calibrate for current person, activated with 'c'
  MODE_INFER // index 2, inference mode with model predictions, activated automatically after MODE_CALIBRATE, but here just in case for testing
};

constexpr int RECORD_MODE_INTERVAL = 10; // in ms
constexpr int FEATURE_SAMPLE_INTERVAL = 1000 / kTrainingSampleRateHz; // 1000ms / 50Hz = 20 ms per sample

RuntimeMode runtimeMode = MODE_RECORD; // record is the default mode, just for testing purposes when plugged into serial and stuff
unsigned long lastSampleTime = 0; // track timestamp (ms) of last sample
unsigned long inferenceWindowCounter = 0; // counts how manu inference windows have been processed

// sliding window buffers for the 3 accelerometer axis values
// inference runs when buffers are full from calibration
float xWindow[kWindowSamples];
float yWindow[kWindowSamples];
float zWindow[kWindowSamples];
int windowIndex = 0;

bool calibrationReady = false;
int calibrationWindowCount = 0; // how many calibration windows have been collected so far
float calibrationMean[kFeatureCount]; // uses Welford online algorithm to calculate per feature mean
float calibrationM2[kFeatureCount]; // welford intermediate sum of squared deviations
float calibrationStd[kFeatureCount]; // per-feature standard deviation from M2


// thresholds for what makes a fall count as a fall
constexpr float MODEL_FALL_CONFIDENCE_THRESHOLD = 0.55f; // model has to be over 55% confident
constexpr float FALL_IMPACT_RANGE_THRESHOLD = 1.40f; // sharp movement threshold, has to be sharper than this to be counted as a fall
constexpr float MAGNITUDE_FORCE_THRESHOLD = 2.35f;  //  magnitude (in g) indicating impact
constexpr float PATIENT_STILLNESSTHRESHOLD = 0.20f; // check if person still after to make sure it actually a fall

int consecutiveFallWindows = 0; // tracks how many windows deteced as possible falls in a row
int postFallCount = 0; // countdown for how many windows pass after a fall is detected
int fallAlertActiveCount = 0; // countdown for how much longer to hold alert active
bool previousFallAlertState = false; 

static uint8_t lastAdvertisedStateIndex = 255; // 255 is used as unintialised value. used to avoid redundant BLE restart calls.

// holds the top 2 results from a single inference pass
struct InferenceSummary {
  int bestIndex;
  int secondIndex;
  float bestScore;
  float secondScore;
};

// holds the fall detection decision for one window
struct FallDecision {
  bool candidate;
  bool alertActive;
  bool impactDetected;
  bool lowMotionDetected;
  const char* state;
};


// methods that all handle converting the raw data to printable values
void printHeader() {
  SAFE_PRINTLN_MACRO("timestamp_ms,ax,ay,az");
}

void printModeHelp() {
  SAFE_PRINTLN_MACRO("Commands: r=record, c=calibrate, i=infer, p=status, h=help");
  SAFE_PRINTLN_MACRO("BLE: write ASCII 'r'/'c'/'i' to modeCommand characteristic");
}

// converts a RunTimeMode object to a printable object
const char* modeName(RuntimeMode mode) {
  switch (mode) {
    case MODE_RECORD: return "record";
    case MODE_CALIBRATE: return "calibrate";
    case MODE_INFER: return "infer";
  }
  return "unknown";
}

void printRuntimeStatus() {
  SAFE_PRINT_MACRO("STATUS,mode="); 
  SAFE_PRINT_MACRO(modeName(runtimeMode));

  SAFE_PRINT_MACRO(",cal_ready="); 
  SAFE_PRINT_MACRO(calibrationReady ? 1 : 0);

  SAFE_PRINT_MACRO(",cal_count="); 
  SAFE_PRINT_MACRO(calibrationWindowCount);

  SAFE_PRINT_MACRO(",cal_target="); 
  SAFE_PRINT_MACRO(kCalibrationWindowTarget);

  SAFE_PRINT_MACRO(",window_fill="); 
  SAFE_PRINT_MACRO(windowIndex);

  SAFE_PRINT_MACRO("/"); 
  SAFE_PRINT_MACRO(kWindowSamples);
}

// announces what the current mode and config is (only used over serial)
void announceMode(bool includeHint = true) { //hint just prints extra info
  SAFE_PRINT_MACRO("MODE,mode=");        
  SAFE_PRINT_MACRO(modeName(runtimeMode));
// in RECORD mode the actual hardware sample rate is ~100 Hz; in other modes it's 50 Hz.

  SAFE_PRINT_MACRO(",sample_rate_hz=");  
  SAFE_PRINT_MACRO(runtimeMode == MODE_RECORD ? 100 : kTrainingSampleRateHz);

  SAFE_PRINT_MACRO(",window_samples=");  
  SAFE_PRINT_MACRO(kWindowSamples);

  SAFE_PRINT_MACRO(",cal_ready=");       
  SAFE_PRINTLN_MACRO(calibrationReady ? 1 : 0);
 
  if (!includeHint) {
    return;
  }

  if (runtimeMode == MODE_CALIBRATE) {
    SAFE_PRINTLN_MACRO("INFO,action=walk_normally_for_calibration");
  } 
  else if (runtimeMode == MODE_INFER && !calibrationReady) {
    SAFE_PRINTLN_MACRO("INFO,action=calibration_required_before_inference");
  }
}

// methods to reset the arduino at the end of each usage cycle (so unplugging or battery dying kills it)
// might remove this later on to store usage data long term? idk yet
void resetWindowBuffer() { 
  // clears the window fill index so new records start writing from the beginning
  windowIndex = 0;
}

//holds the inference values until there are 90 then pushes them out together so data appears continuous
void slideWindow(int hopSamples) {
  int retain = kWindowSamples - hopSamples;
  memmove(xWindow, xWindow + hopSamples, retain * sizeof(float));
  memmove(yWindow, yWindow + hopSamples, retain * sizeof(float));
  memmove(zWindow, zWindow + hopSamples, retain * sizeof(float));
  windowIndex = retain;
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
  consecutiveFallWindows = 0;
  postFallCount = 0;
  fallAlertActiveCount = 0;
}

// own implementation of Math.clamp() in java, to make sure float values stay within a range
float floatConstraint(float value, float low, float high) {
  if (value < low){
    return low;
  }

  if (value > high){
    return high;
  }

  return value;
}

// calculates useful statistics over an array of float values
void calculateStatistics(const float* values, int count, float& mean, float& stddev, float& minValue, float& maxValue, float& rangeValue, float& meanSquared) {
  float sum = 0.0f, sumSquares = 0.0f;
  minValue = values[0];
  maxValue = values[0];

  // accumulate sum, sum-of-squares, min, and max
  for (int i = 0; i < count; ++i) {
    const float v = values[i];
    sum += v;
    sumSquares += v * v;

    if (v < minValue){
      minValue = v;
    }

    if (v > maxValue){
      maxValue = v;
    }
  }

  mean = sum / count;
  meanSquared = sumSquares / count; // signal energy stand in

  float variance = 0.0f;

  // compute variance using the calculated mean
  for (int i = 0; i < count; ++i) {
    const float delta = values[i] - mean;
    variance += delta * delta;
  }

  stddev = sqrtf(variance / count);
  rangeValue = maxValue - minValue;
}

// calculates a 24-element feature vector from the current window buffer data
// this is input for the ML model predictions
void extractFeatureVector(float* outFeatures) {
  float magnitude[kWindowSamples];

  // calculate the total magnitude for current window
  for (int i = 0; i < kWindowSamples; ++i) {
    magnitude[i] = sqrtf(xWindow[i] * xWindow[i] + yWindow[i] * yWindow[i] + zWindow[i] * zWindow[i]);
  }

  const float* axisBuffers[3] = {xWindow, yWindow, zWindow}; // 3 is because we have 3 axes (x, y, z)

  int count = 0; 

  for (int axis = 0; axis < 3; ++axis) { // 3 is because we have 3 axes (x, y, z) (again)
    // calculate the following values from the window buffer then put it into the outFeatures array 
    float mean, stddev, minValue, maxValue, rangeValue, meanSquared;
    calculateStatistics(axisBuffers[axis], kWindowSamples, mean, stddev, minValue, maxValue, rangeValue, meanSquared);

    outFeatures[count++] = mean;
    outFeatures[count++] = stddev;
    outFeatures[count++] = minValue;
    outFeatures[count++] = maxValue;
    outFeatures[count++] = rangeValue;
    outFeatures[count++] = meanSquared;
  }

  float mean, stddev, minValue, maxValue, rangeValue, meanSquared;
  calculateStatistics(magnitude, kWindowSamples, mean, stddev, minValue, maxValue, rangeValue, meanSquared);

  outFeatures[count++] = mean;
  outFeatures[count++] = stddev;
  outFeatures[count++] = minValue;
  outFeatures[count++] = maxValue;
  outFeatures[count++] = rangeValue;
  outFeatures[count++] = meanSquared;
}

// incremenetal mean and variance updates using Welford's algorithm
// updates stats in each window without storing all past feature vectors 
//properly tracks number of windows
void updateCalibration(const float* featureVector) {
  calibrationWindowCount++; //changed count as it was undefined

  // step 1: update running mean
  for (int i = 0; i < kFeatureCount; ++i) {
    const float delta = featureVector[i] - calibrationMean[i];
    calibrationMean[i] += delta / calibrationWindowCount;
  
    // step 2: update M2 (sum of squared deviations)
    const float delta2 = featureVector[i] - calibrationMean[i];
    calibrationM2[i] += delta * delta2;

    // standard deviation from M2 (which requires more than 2 samples)
    if (calibrationWindowCount > 1) {
      calibrationStd[i] = sqrtf(calibrationM2[i] / (calibrationWindowCount - 1));

      if (calibrationStd[i] < 1e-6f){
        // guard againnst div by 0 errors
        calibrationStd[i] = 1.0f;
      }
    }
  }

  if (calibrationWindowCount >= kCalibrationWindowTarget) {
    calibrationReady = true;
  }
}

// z-score normalisation using calibration mean and standard deviation
// maps current users personal baseline to be 0 
void applyCalibration(float* featureVector) {
  
  if (!calibrationReady){
    return;
  }
  
  for (int i = 0; i < kFeatureCount; ++i) {
    featureVector[i] = (featureVector[i] - calibrationMean[i]) / calibrationStd[i];
  }
}

void printCalibrationStatus() {
  SAFE_PRINT_MACRO("CALIBRATION,status=");
  SAFE_PRINT_MACRO(calibrationReady ? "ready" : "collecting");
  
  SAFE_PRINT_MACRO(",count=");
  SAFE_PRINT_MACRO(calibrationWindowCount);
  
  SAFE_PRINT_MACRO(",target=");             
  SAFE_PRINT_MACRO(kCalibrationWindowTarget);
  
  SAFE_PRINT_MACRO(",mode=");               
  SAFE_PRINTLN_MACRO(modeName(runtimeMode));
}


#if ENABLE_TINYML

bool setupTinyMl() {
  // :: syntax for namespaces
  tfliteModel = tflite::GetModel(g_model_tflite);

  // -> is a pointer to an object
  if (tfliteModel->version() != TFLITE_SCHEMA_VERSION) {
    SAFE_PRINTLN_MACRO("ERROR,tflite_schema_mismatch");
    return false;
  }

  static tflite::MicroInterpreter staticInterpreter(
    tfliteModel, resolver, tensorArena, kTensorArenaSize, nullptr, nullptr
    // nullptrs are for error reporting and profiling
  );

  interpreter = &staticInterpreter; //pointer for inference

  //assign memory regions for tensors
  if (interpreter->AllocateTensors() != kTfLiteOk) {
    SAFE_PRINTLN_MACRO("ERROR,tensor_allocation_failed");
    return false;
  }

  //actually used area
  size_t usedBytes = interpreter->arena_used_bytes();
  SAFE_PRINT_MACRO("INFO,arena_used_bytes=");
  SAFE_PRINT_MACRO(usedBytes);
  SAFE_PRINT_MACRO(",arena_total_bytes=");
  SAFE_PRINTLN_MACRO(kTensorArenaSize);

  //pointers for fast access to loop
  inputTensor = interpreter->input(0);
  outputTensor = interpreter->output(0);

  //quantization type validation
  if (inputTensor->type != kTfLiteInt8 || outputTensor->type != kTfLiteInt8) {
    SAFE_PRINTLN_MACRO("ERROR,model_quantization_mismatch");
    return false;
  }

  //tensor shapes validation
  //last dimension holds the feature/class count
  const int inputFeatureCount = inputTensor->dims->data[inputTensor->dims->size - 1];
  const int outputClassCount = outputTensor->dims->data[outputTensor->dims->size - 1];

  if (inputFeatureCount != kFeatureCount){ 
    SAFE_PRINTLN_MACRO("ERROR,input_feature_count_mismatch"); 
    return false; 
  }
  
  if (outputClassCount != kClassCount) { 
    SAFE_PRINTLN_MACRO("ERROR,output_class_count_mismatch");  
    return false; 
  }

  return true;
}

//run a forward pass of the model on a provided feature vector
//adds top 2 predictions to the inference summary to be displayed in serial / sent over ble
bool runInference(const float* featureVector, InferenceSummary& summary) {
  summary.bestIndex = 0;
  summary.secondIndex = 0;
  summary.bestScore = -1000.0f;
  summary.secondScore = -1000.0f;

  for (int i = 0; i < kFeatureCount; ++i) {
    //quantisation stuff
    const float standardized = (featureVector[i] - kGlobalFeatureMean[i]) / kGlobalFeatureStd[i];
    const int32_t quantized = (int32_t)roundf(standardized / kInputScale) + kInputZeroPoint;
    // above global values come from model_settings.h

    //constrain the floats to valid range
    inputTensor->data.int8[i] = (int8_t)floatConstraint((float)quantized, -128.0f, 127.0f);
  }

  ///run the model
  if (interpreter->Invoke() != kTfLiteOk) {
    SAFE_PRINTLN_MACRO("ERROR,inference_failed");
    return false;
  }

  //finds the top two predictions via comparison 
  for (int i = 0; i < kClassCount; ++i) {
    const float score = (outputTensor->data.int8[i] - kOutputZeroPoint) * kOutputScale;
    if (score > summary.bestScore) {
      summary.secondScore = summary.bestScore;
      summary.secondIndex = summary.bestIndex;
      summary.bestScore = score;
      summary.bestIndex = i;
    } 
    else if (score > summary.secondScore) {
      summary.secondScore = score;
      summary.secondIndex = i;
    }
  }

  return true;
}
#endif

bool isStillnessClass(int classIndex) {
  // just a check to see if any of the indices belong to a stillness class
  // easier than a long || statement
  // 2 is idle_stand, 3 is idle_sit, 6 is fall
  return classIndex == 2 || classIndex == 3  || classIndex == 6;
}


FallDecision makeFallDecision(const InferenceSummary& summary, const float* rawFeatureVector) {
  const float magnitudeStd = rawFeatureVector[19]; //19 is the standard magnitude index in the vector, so how much the motion varies
  const float magnitudeMax = rawFeatureVector[21]; //21 is the max magnitude index in the vector, so the peak acceleration
  const float magnitudeRange = rawFeatureVector[22]; //22 is the magnitude range index in the vector, so the change in acceleration

  FallDecision decision;


  // check for impact
 decision.impactDetected = magnitudeMax >= MAGNITUDE_FORCE_THRESHOLD || magnitudeRange >= FALL_IMPACT_RANGE_THRESHOLD;
// check if patient still after fall
  decision.lowMotionDetected = magnitudeStd <= PATIENT_STILLNESSTHRESHOLD; // check if person is still after to make sure it actually a fall

  // all 3 conditions have to be true for a fall alert alongside the impact
  decision.candidate = summary.bestIndex == 6 && summary.bestScore >= MODEL_FALL_CONFIDENCE_THRESHOLD && decision.impactDetected;   // 6 is the fall index

  decision.alertActive = false;
  decision.state = "none";

  //keeps alert active
  const bool alertWasLatched = fallAlertActiveCount > 0;
  if (alertWasLatched){
    fallAlertActiveCount--;
  }

  const bool postFallObservationPeriod = postFallCount > 0;

  if (decision.candidate) {
    consecutiveFallWindows++;
    postFallCount = 2; //needs to have more than 2 stillness detections to be counted
    // reset the observation period
  } 
  else {
    consecutiveFallWindows = 0; //reset streak if theres no detected valid fall
    
    if (postFallCount > 0){
      postFallCount--;
    }
  }

  //confirm that fall is persistent and wasnt just a random blip
  const bool persistenceConfirmed = decision.candidate && consecutiveFallWindows >= 2; // needs to have more than 2 fall detections from the model to be counted as a fall
  const bool lowMotionConfirmed = postFallObservationPeriod && decision.lowMotionDetected && isStillnessClass(summary.bestIndex);

  //finally send out the fall decision and alert
  if (persistenceConfirmed || lowMotionConfirmed) {
    decision.alertActive = true;
    decision.state = "alert";
    fallAlertActiveCount = 2; // keep fall as the category for 2 extra detections, just in case
    postFallCount = 0;
    consecutiveFallWindows = 0;
  } 
  else if (alertWasLatched || fallAlertActiveCount > 0) {
    decision.alertActive = true;
    decision.state = "alert";

  } 
  else if (decision.candidate || postFallCount > 0) {
    decision.state = "pending";
  }

  return decision;
}

// converts a class index into its string label
const char* labelForIndex(int index) {
  if (index < 0 || index >= kClassCount) {
    return "unknown";
  }

  return kClassLabels[index];
}

//updates the BLE packets on the current state
//scanner doesnt need to fully connect, it can just passively scan for the uuid changes
//only used for fall detection because fall is urgent other state changes are not
void updatePassiveBLEAdvertisement(uint8_t stateIndex, bool alertActive) {
  static bool lastAlertState = false;

  //skips if theres no change in state
  if (stateIndex == lastAdvertisedStateIndex && alertActive == lastAlertState){
    return;
  } 

  //updates the global variables to be the current state
  lastAdvertisedStateIndex = stateIndex;
  lastAlertState = alertActive;

  BLE.stopAdvertise();

  // stateIndex contained in manufacturer data so passive scanners can read it
  uint8_t mfrPayload[1] = { stateIndex };
  BLE.setManufacturerData(0xFFFF, mfrPayload, sizeof(mfrPayload));

  //switch the uuid based on the alert state
  if (alertActive) {
    BLE.setAdvertisedService(fallDetectedService);
  } 
  else {
    BLE.setAdvertisedService(normalService);
  }

  BLE.advertise();

  //log state changes
  if (alertActive) {
    SAFE_PRINTLN_MACRO("BLE_PASSIVE,uuid=FF01,state=fall_alert");
  } 
  else {
    SAFE_PRINTLN_MACRO("BLE_PASSIVE,uuid=19B10000,state=normal");
  }

  SAFE_PRINT_MACRO("BLE_PASSIVE,state_index=");
  SAFE_PRINT_MACRO(stateIndex);

  SAFE_PRINT_MACRO(",label=");
  SAFE_PRINTLN_MACRO(labelForIndex(stateIndex));
}

//sends notifications/updates to connected clients (the scanners)
void updateBleCharacteristicsonScanners(const InferenceSummary& summary, const FallDecision& decision) {
  //updates the fall decision if state changed
  if (decision.alertActive != previousFallAlertState) {
    fallAlertCharacteristic.writeValue(decision.alertActive ? (uint8_t)1 : (uint8_t)0);
    previousFallAlertState = decision.alertActive;
  }

  //keeps prediciton confidence for manager side
  predictionCharacteristic.writeValue((uint8_t)summary.bestIndex);

  const uint8_t confByte = (uint8_t)floatConstraint(summary.bestScore * 100.0f, 0.0f, 100.0f);
  confidenceCharacteristic.writeValue(confByte);
}

//sends out passive and active notification when fall happens (its an emergency)
void publishFallState(const InferenceSummary& summary, const FallDecision& decision) {
  updateBleCharacteristicsonScanners(summary, decision);
  updatePassiveBLEAdvertisement((uint8_t)summary.bestIndex, decision.alertActive);
}


//allows mode switching
void switchModeTo(char command) {
  command = (char)tolower(command);

  if (command == 'r') {
    runtimeMode = MODE_RECORD;
    resetWindowBuffer();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    updatePassiveBLEAdvertisement(lastAdvertisedStateIndex, false);  
    announceMode(false);
    printHeader();

  } 
  else if (command == 'c') {
    runtimeMode = MODE_CALIBRATE;
    resetWindowBuffer();
    resetCalibration();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    updatePassiveBLEAdvertisement(lastAdvertisedStateIndex, false); 
    announceMode();

  } 
  else if (command == 'i') {
    
    if (!calibrationReady) {
      SAFE_PRINTLN_MACRO("WARN,infer_blocked_calibration_required");
      return;
    }
    
    runtimeMode = MODE_INFER;
    resetWindowBuffer();
    resetFallPostProcessing();
    inferenceWindowCounter = 0;
    announceMode();
  } 
  else if (command == 'p') {
    printRuntimeStatus();
    printCalibrationStatus();
  } 
  else if (command == 'h') {
    printModeHelp();
    printRuntimeStatus();

  } 
  else if (command == 'f') {
    updatePassiveBLEAdvertisement(lastAdvertisedStateIndex, true);
    fallAlertCharacteristic.writeValue((uint8_t)1);
    previousFallAlertState = true;
    SAFE_PRINTLN_MACRO("DEBUG,simulated_fall_alert=ON");
  } 
  else if (command == 'x') {
    updatePassiveBLEAdvertisement(lastAdvertisedStateIndex, false);
    fallAlertCharacteristic.writeValue((uint8_t)0);
    previousFallAlertState = false;
    SAFE_PRINTLN_MACRO("DEBUG,simulated_fall_alert=OFF");
  }
}

//following two methods just handle mode switches over serial or over ble
void handleSerialCommands() {
  if (!Serial.available()){
  return;
  }
    switchModeTo((char)Serial.read());
}

void handleBleCommands() {
  if (!modeCommandCharacteristic.written()){
    return;
  }

  const uint8_t raw = modeCommandCharacteristic.value();
  
  if (raw == 0){
    return;
  }

  switchModeTo((char)raw);
}

//initialises ble with services and characteristics and logging
bool setupBle() {
  if (!BLE.begin()) {
    SAFE_PRINTLN_MACRO("ERROR,ble_init_failed");
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

  SAFE_PRINT_MACRO("INFO,ble=advertising,name=");
  SAFE_PRINT_MACRO(DEVICE_NAME);
  SAFE_PRINTLN_MACRO(",passive_uuid=181C");
  return true;
}


//method to print all the details in the inference stage
void printInferenceSummary(const InferenceSummary& summary, const FallDecision& decision, const float* rawFeatureVector) {
  SAFE_PRINT_MACRO("INFER,mode=");             
  SAFE_PRINT_MACRO(modeName(runtimeMode));
  
  SAFE_PRINT_MACRO(",window=");                
  SAFE_PRINT_MACRO(inferenceWindowCounter);
  
  SAFE_PRINT_MACRO(",pred=");                  
  SAFE_PRINT_MACRO(labelForIndex(summary.bestIndex));
  
  SAFE_PRINT_MACRO(",conf=");                  
  SAFE_PRINT_WITH_DECIMAL_MACRO(summary.bestScore, 4);
  
  SAFE_PRINT_MACRO(",top2=");                  
  SAFE_PRINT_MACRO(labelForIndex(summary.secondIndex));
  
  SAFE_PRINT_MACRO(",top2_conf=");             
  SAFE_PRINT_WITH_DECIMAL_MACRO(summary.secondScore, 4);
  
  SAFE_PRINT_MACRO(",fall_state=");            
  SAFE_PRINT_MACRO(decision.state);
  
  SAFE_PRINT_MACRO(",fall_candidate=");        
  SAFE_PRINT_MACRO(decision.candidate ? 1 : 0);
  
  SAFE_PRINT_MACRO(",fall_alert=");            
  SAFE_PRINT_MACRO(decision.alertActive ? 1 : 0);
  
  SAFE_PRINT_MACRO(",impact=");                
  SAFE_PRINT_MACRO(decision.impactDetected ? 1 : 0);
  
  SAFE_PRINT_MACRO(",low_motion=");            
  SAFE_PRINT_MACRO(decision.lowMotionDetected ? 1 : 0);
  
  SAFE_PRINT_MACRO(",mag_std=");               
  SAFE_PRINT_WITH_DECIMAL_MACRO(rawFeatureVector[19], 4); //19 is the index of the standard magnitude
  
  SAFE_PRINT_MACRO(",mag_max=");               
  SAFE_PRINT_WITH_DECIMAL_MACRO(rawFeatureVector[21], 4); //21 is the index of the max magnitude
  
  SAFE_PRINT_MACRO(",mag_range=");             
  SAFE_PRINT_WITH_DECIMAL_MACRO(rawFeatureVector[22], 4); //22 is the index of the magnitude range
  
  SAFE_PRINT_MACRO(",cal_ready=");             
  SAFE_PRINT_MACRO(calibrationReady ? 1 : 0);
  
  SAFE_PRINT_MACRO(",cal_count=");             
  SAFE_PRINTLN_MACRO(calibrationWindowCount);
}

//returns the current sampling interval from the imu
int getActiveSampleIntervalMs() {
  return runtimeMode == MODE_RECORD ? RECORD_MODE_INTERVAL : FEATURE_SAMPLE_INTERVAL;
}

//stores one accelerometer reading into a window buffer
void storeAccelerometerData(float ax, float ay, float az) {
  if (windowIndex >= kWindowSamples) {
    return;
  }
  
  xWindow[windowIndex] = ax;
  yWindow[windowIndex] = ay;
  zWindow[windowIndex] = az;
  windowIndex++;
}

//when the windows full it processes the calibration and inference modes
// extracts features
// then resets the buffer
void processWindowIfReady() {
  if (windowIndex < kWindowSamples){
    return;
  }

  static float rawFeatureVector[kFeatureCount];
  static float modelFeatureVector[kFeatureCount];

  extractFeatureVector(rawFeatureVector);

  //calibration mode automatically switches to infer afterwards
  if (runtimeMode == MODE_CALIBRATE) {
    updateCalibration(rawFeatureVector);

    SAFE_PRINT_MACRO("CALIBRATION,progress="); 
    SAFE_PRINT_MACRO(calibrationWindowCount);
    
    SAFE_PRINT_MACRO(",target=");              
    SAFE_PRINT_MACRO(kCalibrationWindowTarget);
    
    SAFE_PRINT_MACRO(",ready=");               
    SAFE_PRINTLN_MACRO(calibrationReady ? 1 : 0);

    if (calibrationReady) {
      SAFE_PRINTLN_MACRO("CALIBRATION,status=complete");
      printCalibrationStatus();
      runtimeMode = MODE_INFER;
      resetWindowBuffer();
      resetFallPostProcessing();
      inferenceWindowCounter = 0;
      delay(50);
      announceMode();
    }

  } //infer mode still possible for reset reasons
  else if (runtimeMode == MODE_INFER) {
    if (!calibrationReady) {
      SAFE_PRINTLN_MACRO("INFO,action=calibration_required_before_inference");
    } 
    else {
      
      for (int i = 0; i < kFeatureCount; ++i) {
        modelFeatureVector[i] = rawFeatureVector[i];
      }

      applyCalibration(modelFeatureVector);

      inferenceWindowCounter++;

      #if ENABLE_TINYML
            InferenceSummary summary;

            if (runInference(modelFeatureVector, summary)) {
              const FallDecision decision = makeFallDecision(summary, rawFeatureVector);
              printInferenceSummary(summary, decision, rawFeatureVector);
              publishFallState(summary, decision);
            }

      #else
            SAFE_PRINTLN_MACRO("INFERENCE_DISABLED,build_with_ENABLE_TINYML=1");
      #endif
    }
  }

  if (runtimeMode == MODE_INFER) {
    slideWindow(10); // 90% overlap, inference every 0.2s
  } else {
    resetWindowBuffer(); // calibrate uses full non-overlapping windows
  }
}

// SETUP AND LOOP ENTRY POINTS

void setup() {
  Serial.begin(115200);

  pinMode(LED_BUILTIN, OUTPUT);

  //led light is used as ble indication + to show board is alive
  if (!IMU.begin()) {
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH); 
      delay(100);
      
      digitalWrite(LED_BUILTIN, LOW);  
      delay(100);
    }
  }

  if (!setupBle()) {
    SAFE_PRINTLN_MACRO("WARN,ble_unavailable_continuing_without_ble");
  }

  resetCalibration();
  resetFallPostProcessing();

  printModeHelp();
  announceMode(false);
  printRuntimeStatus();
  printHeader(); //as check

#if ENABLE_TINYML
  if (!setupTinyMl()) {
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH); 
      delay(500);
      
      digitalWrite(LED_BUILTIN, LOW);  
      delay(500);
    }
  }
  SAFE_PRINTLN_MACRO("INFO,model=enabled");
#else
  SAFE_PRINTLN_MACRO("INFO,model=disabled_enable_tinyml_to_infer");
#endif
}

void loop() {
  BLE.poll(); //handles connections and disconnections

  BLEDevice central = BLE.central();
  digitalWrite(LED_BUILTIN, (central && central.connected()) ? HIGH : LOW);

  handleSerialCommands();
  handleBleCommands();

  const unsigned long now = millis();
  
  //sample imu without blocking it
  if (now - lastSampleTime < (unsigned long)getActiveSampleIntervalMs()){
    return;
  }
  lastSampleTime = now;

  //accelerometer reading section
  float ax, ay, az;
  float gx, gy, gz;

  const bool accelReady = IMU.accelerationAvailable();

  if (!accelReady){
    return;
  }

  IMU.readAcceleration(ax, ay, az);

  if (runtimeMode == MODE_RECORD) {
    printHeader();
    SAFE_PRINT_MACRO(now);
    SAFE_PRINT_MACRO(",");

    SAFE_PRINT_WITH_DECIMAL_MACRO(ax, 4);
    SAFE_PRINT_MACRO(",");

    SAFE_PRINT_WITH_DECIMAL_MACRO(ay, 4);
    SAFE_PRINT_MACRO(",");

    SAFE_PRINTLN_WITH_DECIMAL_MACRO(az, 4);
    return;
  }

  storeAccelerometerData(ax, ay, az);
  processWindowIfReady();
}
