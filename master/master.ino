#include "common.h"

void setup(void) 
{
  Serial.begin(115200);

  /* LED */
  LED_Init();

#if defined(DEVICE_TYPE_MASTER)
  WIFI_Init();
  DEVICES_Init();

  if (WiFi.getMode() == WIFI_AP) {
    return;
  }
#endif

#if defined(DEVICE_TYPE_SLAVE)
  log_i("Device ID: %d", DB_GetDeviceId());
#endif

  WIRELESS_Init();
  SENSOR_Setup();
}

void loop(void) 
{
}
