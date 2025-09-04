#include "common.h"

void setup(void) 
{
  Serial.begin(115200);
  delay(2000);

  LED_Init();

#if defined(DEVICE_TYPE_MASTER)
  WIFI_Init();
  DEVICES_Init();

  if (WiFi.getMode() == WIFI_AP) {
    return;
  }
#endif

  UART_Init();
  WIRELESS_Init();
  SENSOR_Setup();
}

void loop(void) 
{
}
