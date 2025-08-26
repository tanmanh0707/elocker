#include "common.h"

void setup(void) 
{
  Serial.begin(115200);
  delay(2000);
  UART_Init();
  SENSOR_Setup();
}

void loop(void) 
{
}
