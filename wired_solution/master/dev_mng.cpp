#include "common.h"

#define DEVICE_NUM_BUFFER                   10

typedef struct {
  DeviceId_t id;
  float mA;
  float V;
} __attribute__((packed)) DeviceInfo_st;

std::vector<DeviceInfo_st> devices_;

static void dev_mng_task(void *param);

int8_t LocalDeviceExist(DeviceId_t id)
{
  int8_t index = -1;
  for (size_t i = 0; i < devices_.size(); i++) {
    if (devices_[i].id == id) {
      index = i;
      break;
    }
  }

  return index;
}

void DEVICES_Init()
{
  xTaskCreate(dev_mng_task, "dev_mng_task", 4096, NULL, 2, NULL);
}

void DEVICES_UpdateInfo(DeviceId_t id, float mA, float V)
{
  int8_t dev_index = LocalDeviceExist(id);
  if (dev_index >= 0) {
    devices_[dev_index].id = id;
    devices_[dev_index].mA = mA;
    devices_[dev_index].V = V;
  } else {
    DeviceInfo_st new_dev = { id, mA, V };
    devices_.push_back(new_dev);
    log_i("New device (%d)", id);
  }

  log_i("(%d) %.2f (mA), %.2f (V)", id, mA, V);
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

    if (devices_.size() == 0) {
      continue;
    }

    size_t packet_len = devices_.size() * sizeof(DeviceInfo_st) + 1 /* Number of device */;

    uint8_t *packet = (uint8_t *)malloc(packet_len);
    if (packet) {
      packet[0] = (uint8_t)devices_.size();
      uint8_t *ptr = &packet[1];
      for (size_t i = 0; i < packet[0]; i++) {
        *ptr = devices_[i].id; ptr++;
        memcpy(ptr, &devices_[i].mA, sizeof(float)); ptr += sizeof(float);
        memcpy(ptr, &devices_[i].V, sizeof(float)); ptr += sizeof(float);
      }

      // UART_SendBytes(packet, packet_len);
      TCP_Send(packet, packet_len);
      free(packet);
    } else {
      //
    }
  }
}
