// =====================================================================
//  اوررایدهای کالیبراسیون پنجه — فقط برای باینری شبیه‌ساز (sim).
//
//  چرا یک فایل جدا: بدن توابع Gripper در Gripper.cpp کامپایل می‌شود که
//  واحد ترجمه‌ی جدایی از sim_main.cpp است؛ پس #define داخل sim_main به
//  آن نمی‌رسد. این هدر «تک‌منبع حقیقت» است و از دو راه تزریق می‌شود:
//    ۱) بالای sim_main.cpp با #include معمولی (پیش از هر هدر فریم‌ور)
//    ۲) موقع کامپایل Gripper.cpp برای sim با پرچم:
//         g++ ... -include grip_test_config.h -c Gripper.cpp -o Gripper_sim.o
//  (باینری لینک/اسموک همان Gripper_cpp.o با پیش‌فرض‌های Config.h را دارد.)
//
//  مقدارها عمداً غیرپیش‌فرض‌اند تا همه‌ی دستگیره‌های تنظیم سرووی
//  حلقه‌باز (بدون انکودر) واقعاً تست شوند. Config.h همه‌ی این‌ها را با
//  #ifndef دارد، پس تعریف زودتر = برد.
// =====================================================================
#ifndef GRIP_TEST_CONFIG_H
#define GRIP_TEST_CONFIG_H

#define GRIP_INVERT              true   // جهت معکوس
#define GRIP_TRIM_US             20     // تریم +۲۰µs
#define GRIP_DEADBAND_US         4      // ددبند ۴µs
#define GRIP_REFRESH_HZ          100    // فریم ۱۰ms
#define GRIP_CLOSE_SPEED_DEG_S   30.0f  // بستن آرام
#define GRIP_ACCEL_DEG_S2        240.0f // رمپ شتاب روشن
#define GRIP_IDLE_RELEASE_MS     400    // قطع پالس بعد از ۴۰۰ms بیکاری
#define GRIP_BOOT_DELAY_MS       150    // تأخیر بوت ۱۵۰ms

#endif // GRIP_TEST_CONFIG_H
