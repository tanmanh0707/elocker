#include <Wire.h>
#include <Adafruit_INA219.h>
#include <ESP32_NOW.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_mac.h>
#include <driver/uart.h>
#include <vector>

#define DEVICE_TYPE_MASTER
#define DEVICE_TYPE_SLAVE
#define DEVICE_ID                         0x01

#if defined(DEVICE_TYPE_MASTER) && defined(DEVICE_TYPE_SLAVE)
#error message("Only MASTER or SLAVE can be selected")
#endif

typedef uint8_t                           DeviceId_t;

float SENSOR_GetCurrent_mA(void);
void UART_Init();
bool UART_SendBytes(uint8_t *data, uint16_t data_len);
void WIRELESS_Init();

bool WIRELESS_Broadcast(uint8_t *data, size_t len);
bool WIRELESS_Broadcast(String msg);

void SENSOR_Setup();

void DEVICES_Init();
void DEVICES_UpdateInfo(DeviceId_t id, float mA, float V);
void DEVICES_UpdateInfo(const uint8_t *data, int len);