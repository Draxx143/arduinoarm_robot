#ifndef ROS_INTERFACE_H
#define ROS_INTERFACE_H

#include <ros.h>
#include <sensor_msgs/JointState.h>
#include <std_msgs/String.h>
#include <std_msgs/Bool.h>
#include "MotorController.h"

class ROSInterface {
public:
    ROSInterface(MotorController* controller);
    ~ROSInterface();
    
    void init();
    void update();
    
    // توابع کال‌بک STATIC (اجباری برای rosserial)
    static void jointCommandCallback(const sensor_msgs::JointState& msg);
    static void homingCallback(const std_msgs::Bool& msg);
    static void emergencyStopCallback(const std_msgs::Bool& msg);
    static void enableMotorsCallback(const std_msgs::Bool& msg);
    
    // اشاره‌گر به instance برای دسترسی از توابع static
    static ROSInterface* _instance;
    
private:
    MotorController* _controller;
    ros::NodeHandle _nh;
    
    // Publishers
    ros::Publisher _jointStatePub;
    ros::Publisher _statusPub;
    ros::Publisher _debugPub;
    
    // Subscribers - با توابع static
    ros::Subscriber<sensor_msgs::JointState> _jointCommandSub;
    ros::Subscriber<std_msgs::Bool> _homingSub;
    ros::Subscriber<std_msgs::Bool> _emergencyStopSub;
    ros::Subscriber<std_msgs::Bool> _enableMotorsSub;
    
    // Messages
    sensor_msgs::JointState _jointStateMsg;
    std_msgs::String _statusMsg;
    std_msgs::String _debugMsg;
    
    const char* _jointNames[NUM_AXES];
    unsigned long _lastPublishTime;
    unsigned long _publishInterval;
    
    void setupPublishers();
    void setupSubscribers();
    void updateJointStateMessage();
    void publishJointStates();
    void publishStatus();
};

#endif
