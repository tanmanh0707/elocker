#include "common.h"

#define INA219_SDA_PIN            6
#define INA219_SCL_PIN            7

Adafruit_INA219 ina219;
static bool _deviceFound = false;
float _shuntvoltage = 0;
float _busvoltage = 0;
float _current_mA = 0;

static void sensor_task(void *arg);

void SENSOR_Setup()
{
  Wire.setPins(INA219_SDA_PIN, INA219_SCL_PIN);

  log_i("Searching for INA219...");
#if defined(DEVICE_TYPE_MASTER)
  if (! ina219.begin(&Wire)) {
    log_e("INA219 not found!");
  } else {
    _deviceFound = true;
  }
#else
  while (! ina219.begin(&Wire)) {
    delay(2000);
  }

  _deviceFound = true;
#endif

  // To use a slightly lower 32V, 1A range (higher precision on amps):
  //ina219.setCalibration_32V_1A();
  // Or to use a lower 16V, 400mA range (higher precision on volts and amps):
  // ina219.setCalibration_16V_400mA();

  xTaskCreate(sensor_task, "sensor_task", 4096, NULL, 1, NULL);
  log_i("Measuring voltage and current with INA219 ...");
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

    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

float SENSOR_GetCurrent_mA(void)
{
  return _current_mA;
}