#include "common.h"



void setup(void) 
{
  Serial.begin(115200);
  delay(2000);
  UART_Init();
  SENSOR_Setup();

  Serial.println("Hello!");

  Serial.println("Measuring voltage and current with INA219 ...");
}

void loop(void) 
{
}
