// rosserial stub — فقط تا ROS_Interface.cpp روی host کامپایل/لینک شود
#ifndef ROS_STUB_H
#define ROS_STUB_H
#include <Arduino.h>
namespace ros {
  struct Time { unsigned long sec, nsec; };
  class Publisher {
  public:
    Publisher(const char* t = nullptr, void* m = nullptr) : _t(t), _m(m) {}
    void publish(void*) {}
    const char* _t; void* _m;
  };
  template<typename M> class Subscriber {
  public:
    typedef void (*Cb)(const M&);
    Subscriber(const char* t = nullptr, Cb cb = nullptr) : _t(t), _cb(cb) {}
    const char* _t; Cb _cb;
  };
  class NodeHandle {
  public:
    void initNode() {}
    void spinOnce() {}
    Time now() { Time t; t.sec = 0; t.nsec = 0; return t; }
    void loginfo(const char*) {}
    void logwarn(const char*) {}
    void logerror(const char*) {}
    template<typename P> void advertise(P&) {}
    template<typename S> void subscribe(S&) {}
  };
}
#endif
