#include "common.h"

void setup(void) 
{
  Serial.begin(115200);

  /* LED */
  LED_Init();
  log_i("Device ID: %d", DB_GetDeviceId());
  UART_Init();
  SENSOR_Setup();
}

void loop(void) 
{
}
