#ifndef JOINTSTATE_STUB_H
#define JOINTSTATE_STUB_H
#include <ros.h>
namespace sensor_msgs {
  struct Header { ros::Time stamp; const char* frame_id; };
  struct JointState {
    Header header;
    char** name;     uint8_t name_length;
    float* position; uint8_t position_length;
    float* velocity; uint8_t velocity_length;
    float* effort;   uint8_t effort_length;
  };
}
#endif
