#include "common.h"

#define ESPNOW_WIFI_CHANNEL 6

class ESP_NOW_Peer_Class : public ESP_NOW_Peer {
public:
  // Constructor of the class
  ESP_NOW_Peer_Class(const uint8_t *mac_addr, uint8_t channel, wifi_interface_t iface, const uint8_t *lmk) : ESP_NOW_Peer(mac_addr, channel, iface, lmk) {}

  // Destructor of the class
  ~ESP_NOW_Peer_Class() {}

  // Function to register the master peer
  bool add_peer() {
    if (!add()) {
      log_e("Failed to register the broadcast peer");
      return false;
    }
    return true;
  }

  // Function to print the received messages from the master
  void onReceive(const uint8_t *data, size_t len, bool broadcast) {
    log_i("Received a message from " MACSTR " (%s)\n", MAC2STR(addr()), broadcast ? "broadcast" : "unicast");
    log_i("  Message: %s\n", (char *)data);
  }

  bool send_message(const uint8_t *data, size_t len) {
    if (!send(data, len)) {
      log_e("Failed to broadcast message");
      return false;
    }
    return true;
  }
};

/* Global Variables */
ESP_NOW_Peer_Class *broadcast_peer_ = nullptr;

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

  broadcast_peer_ = new ESP_NOW_Peer_Class(ESP_NOW.BROADCAST_ADDR, ESPNOW_WIFI_CHANNEL, WIFI_IF_STA, nullptr);
  if (!broadcast_peer_->add_peer()) {
    log_e("Failed to register the broadcast peer");
    delay(5000);
    ESP.restart();
  }

  // Register the new peer callback
  // ESP_NOW.onNewPeer(register_new_node, nullptr);

  log_i("ESP-NOW version: %d, max data length: %d\n", ESP_NOW.getVersion(), ESP_NOW.getMaxDataLen());
}

bool WIRELESS_Broadcast(const uint8_t *data, size_t len)
{
  return broadcast_peer_->send_message(data, len);
}

bool WIRELESS_Broadcast(String msg)
{
  return WIRELESS_Broadcast((const uint8_t *)msg.c_str(), msg.length());
}

void WIRELESS_Task()
{

}
