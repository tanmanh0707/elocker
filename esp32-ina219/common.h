#include <Wire.h>
#include <Adafruit_INA219.h>
#include <driver/uart.h>

float SENSOR_GetCurrent_mA(void);

void UART_Init();

void SENSOR_Setup();