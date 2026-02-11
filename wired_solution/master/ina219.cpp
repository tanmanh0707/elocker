#include "common.h"

#define SMOKE_PIN                 4
#define FIRE_PIN                  5
#define INA219_SDA_PIN            6
#define INA219_SCL_PIN            7

Adafruit_INA219 ina219;
static bool _deviceFound = false;
float _shuntvoltage = 0;
float _busvoltage = 0;
float _current_mA = 0;

static void sensor_task(void *arg);

void SENSOR_SMOKE_Setup()
{
  pinMode(SMOKE_PIN, INPUT_PULLUP);
}

void SENSOR_FIRE_Setup()
{
  pinMode(FIRE_PIN, INPUT_PULLUP);
}

bool SENSOR_SMOKE_Detected()
{
  return digitalRead(SMOKE_PIN) == HIGH;
}

bool SENSOR_FIRE_Detected()
{
  return digitalRead(FIRE_PIN) == HIGH;
}

void SENSOR_Setup()
{
  SENSOR_SMOKE_Setup();
  SENSOR_FIRE_Setup();

  Wire.setPins(INA219_SDA_PIN, INA219_SCL_PIN);

  log_i("Searching for INA219...");

  if (ina219.begin(&Wire)) {
    log_i("INA219 Connected!");
    _deviceFound = true;
  } else {
    log_i("INA219 Not found!");
  }

  // To use a slightly lower 32V, 1A range (higher precision on amps):
  //ina219.setCalibration_32V_1A();
  // Or to use a lower 16V, 400mA range (higher precision on volts and amps):
  // ina219.setCalibration_16V_400mA();

  xTaskCreate(sensor_task, "sensor_task", 4096, NULL, 1, NULL);
}

bool SENSOR_IsFound() {
  return _deviceFound;
}

void sensor_task(void *arg)
{
  while (1)
  {
    if (_deviceFound)
    {
      _shuntvoltage = ina219.getShuntVoltage_mV();
      _busvoltage = ina219.getBusVoltage_V();
      _current_mA = ina219.getCurrent_mA();
      log_i("Bus Vol: %.3f, Shunt Vol: %.3f, Current: %.3f", _busvoltage, _shuntvoltage, _current_mA);
#if 0
      float loadvoltage = 0;
      float power_mW = 0;
      power_mW = ina219.getPower_mW();
      loadvoltage = _busvoltage + (_shuntvoltage / 1000);
      Serial.print("Load Voltage:  "); Serial.print(loadvoltage); Serial.println(" V");
      Serial.print("Power:         "); Serial.print(power_mW); Serial.println(" mW");
      Serial.println("");
#endif
    }
    else
    {
      if (ina219.begin(&Wire)) {
        log_i("INA219 Connected!");
        _deviceFound = true;
      }
    }

#if (CONFIG_WIRELESS == 1)
  #if defined(DEVICE_TYPE_SLAVE)
      String msg = ("{\"id\":" + String(DB_GetDeviceId()) +
                    ",\"mA\":" + String(_current_mA, 2) +
                    ",\"V\":" + String(_busvoltage) +
                    "}");
      WIRELESS_Broadcast(msg);
  #endif

  #if defined(DEVICE_TYPE_MASTER)
      DEVICES_UpdateInfo(CONFIG_MASTER_DEVICE_ID, _current_mA, _busvoltage);
  #endif
#endif

    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

float SENSOR_GetCurrent_mA(void)
{
  return _current_mA;
}

float SENSOR_GetVoltage(void)
{
  return _busvoltage;
}
