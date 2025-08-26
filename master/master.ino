#include "common.h"

void setup(void) 
{
  Serial.begin(115200);
  delay(2000);

#if defined(DEVICE_TYPE_MASTER)
  DEVICES_Init();
#endif

  UART_Init();
  SENSOR_Setup();
  WIRELESS_Init();
}

void loop(void) 
{
}
