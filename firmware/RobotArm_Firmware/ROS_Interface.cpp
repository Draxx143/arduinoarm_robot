#include "ROS_Interface.h"
#include "SerialCLI.h"
#include "Config.h"

// ============================================
// تعریف متغیر static
// ============================================
ROSInterface* ROSInterface::_instance = nullptr;

// ============================================
// توابع کال‌بک STATIC
// ============================================

void ROSInterface::jointCommandCallback(const sensor_msgs::JointState& msg) {
    if (_instance && _instance->_controller) {
        if (msg.position_length >= NUM_AXES) {
            
            // FIX: تبدیل صحیح درجه به استپ
            // فرمول: steps = degrees * (stepsPerRev * microstep) / 360.0
            // این مقادیر باید برای هر axis از Config.h خونده بشن
            // برای سادگی از مقادیر axis X به عنوان پایه استفاده می‌کنیم
            // اگر هر axis microstep متفاوت داره، باید آرایه جداگانه تعریف بشه
            const float stepsPerDegree[NUM_AXES] = {
                (AXIS_X_STEPS_PER_REV * AXIS_X_MICROSTEP) / 360.0f,  // Joint 1
                (AXIS_Y_STEPS_PER_REV * AXIS_Y_MICROSTEP) / 360.0f,  // Joint 2
                (AXIS_Z_STEPS_PER_REV * AXIS_Z_MICROSTEP) / 360.0f,  // Joint 3
                (AXIS_A_STEPS_PER_REV * AXIS_A_MICROSTEP) / 360.0f,  // Joint 4
                (AXIS_B_STEPS_PER_REV * AXIS_B_MICROSTEP) / 360.0f   // Joint 5
            };
            
            for (int i = 0; i < NUM_AXES; i++) {
                int32_t targetSteps = (int32_t)(msg.position[i] * stepsPerDegree[i]);
                _instance->_controller->moveTo(i, targetSteps);
            }
            
            #if DEBUG_ROS
            _instance->_nh.loginfo("Joint command received");
            #endif
        }
    }
}

void ROSInterface::homingCallback(const std_msgs::Bool& msg) {
    if (_instance && _instance->_controller && msg.data) {
        _instance->_controller->startHoming();
        #if DEBUG_ROS
        _instance->_nh.loginfo("Homing started");
        #endif
    }
}

void ROSInterface::emergencyStopCallback(const std_msgs::Bool& msg) {
    if (_instance && _instance->_controller) {
        if (msg.data) {
            _instance->_controller->emergencyStop();
            #if DEBUG_ROS
            _instance->_nh.loginfo("Emergency stop triggered");
            #endif
        } else {
            _instance->_controller->clearEmergencyStop();
            #if DEBUG_ROS
            _instance->_nh.loginfo("Emergency stop cleared");
            #endif
        }
    }
}

void ROSInterface::enableMotorsCallback(const std_msgs::Bool& msg) {
    if (_instance && _instance->_controller) {
        if (msg.data) {
            _instance->_controller->enableAllMotors();
            #if DEBUG_ROS
            _instance->_nh.loginfo("Motors enabled");
            #endif
        } else {
            _instance->_controller->disableAllMotors();
            #if DEBUG_ROS
            _instance->_nh.loginfo("Motors disabled");
            #endif
        }
    }
}

// ============================================
// پیاده‌سازی کلاس ROSInterface
// ============================================

ROSInterface::ROSInterface(MotorController* controller)
    : _controller(controller),
      _jointStatePub("/robot/joint_states", &_jointStateMsg),
      _statusPub("/robot/status", &_statusMsg),
      _debugPub("/robot/debug", &_debugMsg),
      _jointCommandSub("/robot/joint_command", jointCommandCallback),
      _homingSub("/robot/homing", homingCallback),
      _emergencyStopSub("/robot/emergency_stop", emergencyStopCallback),
      _enableMotorsSub("/robot/enable_motors", enableMotorsCallback) {
    
    _instance = this;
    
    _jointNames[0] = "joint_1";
    _jointNames[1] = "joint_2";
    _jointNames[2] = "joint_3";
    _jointNames[3] = "joint_4";
    _jointNames[4] = "joint_5";
    
    _lastPublishTime = 0;
    _publishInterval = 50;  // 50ms = 20Hz
}

ROSInterface::~ROSInterface() {
    _instance = nullptr;
}

void ROSInterface::init() {
    _nh.initNode();
    
    setupPublishers();
    setupSubscribers();
    
    _jointStateMsg.name = (char**)_jointNames;
    _jointStateMsg.name_length = NUM_AXES;
    _jointStateMsg.position = (float*)malloc(NUM_AXES * sizeof(float));
    _jointStateMsg.position_length = NUM_AXES;
    _jointStateMsg.velocity = (float*)malloc(NUM_AXES * sizeof(float));
    _jointStateMsg.velocity_length = NUM_AXES;
    _jointStateMsg.effort = (float*)malloc(NUM_AXES * sizeof(float));
    _jointStateMsg.effort_length = NUM_AXES;
    
    for (int i = 0; i < NUM_AXES; i++) {
        _jointStateMsg.position[i] = 0;
        _jointStateMsg.velocity[i] = 0;
        _jointStateMsg.effort[i] = 0;
    }
    
    #if DEBUG_ROS
    _nh.loginfo("ROS Interface initialized");
    #endif
}

void ROSInterface::setupPublishers() {
    _nh.advertise(_jointStatePub);
    _nh.advertise(_statusPub);
    _nh.advertise(_debugPub);
}

void ROSInterface::setupSubscribers() {
    _nh.subscribe(_jointCommandSub);
    _nh.subscribe(_homingSub);
    _nh.subscribe(_emergencyStopSub);
    _nh.subscribe(_enableMotorsSub);
}

void ROSInterface::update() {
    _nh.spinOnce();
    
    unsigned long currentTime = millis();
    if (currentTime - _lastPublishTime >= _publishInterval) {
        publishJointStates();
        publishStatus();
        _lastPublishTime = currentTime;
    }
}

void ROSInterface::publishJointStates() {
    updateJointStateMessage();
    _jointStatePub.publish(&_jointStateMsg);
}

void ROSInterface::updateJointStateMessage() {
    float positions[NUM_AXES];
    bool moving[NUM_AXES];
    bool homed[NUM_AXES];
    bool endstops[NUM_AXES];
    
    _controller->getJointStates(positions, nullptr, moving, homed, endstops);
    
    // FIX: تبدیل صحیح استپ به درجه (معکوس تبدیل در callback)
    const float degreesPerStep[NUM_AXES] = {
        360.0f / (AXIS_X_STEPS_PER_REV * AXIS_X_MICROSTEP),
        360.0f / (AXIS_Y_STEPS_PER_REV * AXIS_Y_MICROSTEP),
        360.0f / (AXIS_Z_STEPS_PER_REV * AXIS_Z_MICROSTEP),
        360.0f / (AXIS_A_STEPS_PER_REV * AXIS_A_MICROSTEP),
        360.0f / (AXIS_B_STEPS_PER_REV * AXIS_B_MICROSTEP)
    };
    
    for (int i = 0; i < NUM_AXES; i++) {
        _jointStateMsg.position[i] = positions[i] * degreesPerStep[i];
        _jointStateMsg.velocity[i] = moving[i] ? 1.0f : 0.0f;
        _jointStateMsg.effort[i]   = moving[i] ? 0.5f : 0.0f;
    }
    
    _jointStateMsg.header.stamp = _nh.now();
}

void ROSInterface::publishStatus() {
    char statusBuffer[256];
    int pos = 0;
    
    bool homed = true;
    bool moving = false;
    bool homing = _controller->isHoming();
    
    for (int i = 0; i < NUM_AXES; i++) {
        Axis* axis = _controller->getAxis(i);
        if (!axis->isHomed()) homed = false;
        if (axis->isMoving()) moving = true;
    }
    
    pos += snprintf(statusBuffer + pos, sizeof(statusBuffer) - pos,
                    "Homed: %s, Moving: %s, Homing: %s",
                    homed  ? "Yes" : "No",
                    moving ? "Yes" : "No",
                    homing ? "In Progress" : "Idle");
    
    for (int i = 0; i < NUM_AXES; i++) {
        Axis* axis = _controller->getAxis(i);
        pos += snprintf(statusBuffer + pos, sizeof(statusBuffer) - pos,
                        ", ES%d: %s",
                        i + 1,
                        axis->getEndstopState() ? "Open" : "Triggered");
    }
    
    _statusMsg.data = statusBuffer;
    _statusPub.publish(&_statusMsg);
}
