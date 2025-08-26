#include "common.h"

#define DEVICE_NUM_BUFFER                   10

typedef struct {
  float mA;
  float V;
} DeviceInfo_st;

uint32_t DEVICE_NUM_MAX = 21;
// DeviceInfo_st devices_[DEVICE_NUM_MAX];
DeviceInfo_st *pDevices_ = NULL;

static void dev_mng_task(void *param);

void DEVICES_Init()
{
  if (pDevices_ == NULL) {
    pDevices_ = (DeviceInfo_st *)calloc(sizeof(DeviceInfo_st), DEVICE_NUM_MAX);
  }

  xTaskCreate(dev_mng_task, "dev_mng_task", 4096, NULL, 2, NULL);
}

void DEVICES_UpdateInfo(DeviceId_t id, float mA, float V)
{
  if (id >= DEVICE_NUM_MAX) {
    /* Resize */
    DEVICE_NUM_MAX = id + DEVICE_NUM_BUFFER;
    DeviceInfo_st *tmp = (DeviceInfo_st *)calloc(sizeof(DeviceInfo_st), DEVICE_NUM_MAX);
    if (tmp) {
      free(pDevices_);
      pDevices_ = tmp;
    }
  }

  if (id < DEVICE_NUM_MAX) {
    pDevices_[id].mA = mA;
    pDevices_[id].V = V;
    log_i("(%d) %.2f (mA), %.2f (V)", id, mA, V);
  } else {
    log_e("Invalid Id (%d)", id);
  }
}

void DEVICES_UpdateInfo(const uint8_t *data, int len)
{
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, data, len);
  if (DeserializationError::Ok == error)
  {
    DEVICES_UpdateInfo(doc["id"].as<int>(), doc["mA"].as<float>(), doc["V"].as<float>());
  }
}

void dev_mng_task(void *param)
{
  while (1)
  {
    delay(2000);
  }
}
