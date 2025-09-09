#include <Wire.h>
#include <Adafruit_INA219.h>
#include <WiFi.h>
#include <AsyncUDP.h>
#include <AsyncTCP.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <esp_mac.h>
#include <driver/uart.h>
#include <vector>
#include "ap_webpages.h"

#define DEVICE_TYPE_MASTER
// #define DEVICE_TYPE_SLAVE

#if defined(DEVICE_TYPE_MASTER) && defined(DEVICE_TYPE_SLAVE)
#error message("Only MASTER or SLAVE can be selected")
#endif

#define CONFIG_MASTER_DEVICE_ID               0x01

#define CONFIG_BUILTIN_LED_PIN                8
#define CONFIG_ESPNOW_DEFAULT_CHANNEL         1

#define CONFIG_UDP_SERVER_PORT                7792
#define CONFIG_UDP_CLIENT_PORT                7792
#define CONFIG_TCP_SERVER_PORT                7792

#define CONFIG_WIFI_AP_SSID                   "eLocker AP"
#define CONFIG_WIFI_AP_PASSWORD               "12345678"
#define CONFIG_WIFI_CONNECT_TIMEOUT           20000

typedef enum {
  LED_CMD_OFF = (0),
  LED_CMD_STARTUP,
  LED_CMD_WIFI_CONNECTING,
  LED_CMD_WIFI_CONNECTED,
  LED_CMD_WIFI_FAILED,
  LED_CMD_AP_MODE,
  LED_CMD_POWER_OFF,
  LED_CMD_MAX
} LedCtrlCmd_e;

typedef uint8_t                           DeviceId_t;

typedef struct {
  uint8_t cmd;
  uint8_t *data;
  uint16_t len;
} QueueMsg_st;

float SENSOR_GetCurrent_mA(void);
void UART_Init();
bool UART_SendBytes(uint8_t *data, uint16_t data_len);

void WIFI_Init();
void WIFI_AP_ServerLoop();

void WIRELESS_Init();
void WIRELESS_Task();
bool WIRELESS_Broadcast(const uint8_t *data, size_t len);
bool WIRELESS_Broadcast(String msg);
bool WIRELESS_IsDiscovered();
void WIRELESS_ChannelDiscoverLoop(byte channel_start = CONFIG_ESPNOW_DEFAULT_CHANNEL);

void TCP_Send(uint8_t *data, size_t len);

/* Sensor */
void SENSOR_Setup();
bool SENSOR_IsFound();

/* LED */
void LED_Init();
void LED_SendCmd(LedCtrlCmd_e cmd);

void DEVICES_Init();
void DEVICES_UpdateInfo(DeviceId_t id, float mA, float V);
void DEVICES_UpdateInfo(const uint8_t *data, int len);

int DB_GetDeviceId(int default_value = 2);
void DB_GetWifiCredentials(String &ssid, String &password);
void DB_SetWifiCredentials(String &ssid, String &password);
uint8_t DB_GetEspNowChannel();
void DB_SetEspNowChannel(uint8_t new_channel);