#include "common.h"

#define ESPNOW_WIFI_CHANNEL 6

class ESP_NOW_Broadcast_Peer : public ESP_NOW_Peer {
public:
  // Constructor of the class using the broadcast address
  ESP_NOW_Broadcast_Peer(uint8_t channel, wifi_interface_t iface, const uint8_t *lmk) : ESP_NOW_Peer(ESP_NOW.BROADCAST_ADDR, channel, iface, lmk) {}

  // Destructor of the class
  ~ESP_NOW_Broadcast_Peer() { remove(); }

  // Function to properly initialize the ESP-NOW and register the broadcast peer
  bool begin() {
    if (!ESP_NOW.begin() || !add()) {
      log_e("Failed to initialize ESP-NOW or register the broadcast peer");
      return false;
    }
    return true;
  }

  // Function to send a message to all devices within the network
  bool send_message(const uint8_t *data, size_t len) {
#if defined(DEVICE_TYPE_SLAVE)
    if (!send(data, len)) {
      log_e("Failed to broadcast message");
      return false;
    }
#endif
    return true;
  }

  void onSent(bool success) {

  }
};

/* Global Variables */
static ESP_NOW_Broadcast_Peer _broadcaster(ESPNOW_WIFI_CHANNEL, WIFI_IF_STA, nullptr);

#if defined(DEVICE_TYPE_MASTER)
void onBroadcastReceive(const esp_now_recv_info_t *info, const uint8_t *data, int len, void *arg)
{
  // log_i("Received a message from " MACSTR " ", MAC2STR(info->src_addr));
  DEVICES_UpdateInfo(data, len);
}
#endif

void WIRELESS_Init()
{
  WiFi.mode(WIFI_STA);
  WiFi.setChannel(ESPNOW_WIFI_CHANNEL);

  log_i("Wi-Fi parameters:");
  log_i("  Mode: STA");
  log_i("  MAC Address: " MACSTR " ", MAC2STR(WiFi.macAddress()));
  log_i("  Channel: %d", ESPNOW_WIFI_CHANNEL);

  // Initialize the ESP-NOW protocol
  if (!ESP_NOW.begin()) {
    log_e("Failed to initialize ESP-NOW");
    log_e("Reeboting in 5 seconds...");
    delay(5000);
    ESP.restart();
  }

  if (!_broadcaster.begin()) {
    log_e("Failed to register the _broadcaster");
  }

#if defined(DEVICE_TYPE_MASTER)
  // Register the new peer callback
  ESP_NOW.onNewPeer(onBroadcastReceive, nullptr);
#endif
}

bool WIRELESS_Broadcast(const uint8_t *data, size_t len)
{
  return _broadcaster.send_message(data, len);
}

bool WIRELESS_Broadcast(String msg)
{
  return WIRELESS_Broadcast((const uint8_t *)msg.c_str(), msg.length());
}

void WIRELESS_Task()
{

}
