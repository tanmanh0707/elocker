#include "common.h"
#include <esp_now.h>

#define TCP_QUEUE_SIZE                        10

uint8_t _broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

#if defined(DEVICE_TYPE_MASTER)
static AsyncUDP _udpServer;
static AsyncServer _tcpServer(CONFIG_TCP_SERVER_PORT);
const char *udp_broadcast_msg = "Where are you?";
const char *udp_response_msg = "Here I am";
static AsyncClient *_tcpClient = nullptr;
static WebServer _apServer(80);
static TaskHandle_t _tcpTaskHdl = NULL;
static QueueHandle_t _tcpQ = NULL;
#endif

#if defined(DEVICE_TYPE_SLAVE)
static bool espnowDiscovered_ = false;
static bool LocalModifyBroadcastPeer(uint8_t new_channel);
#endif

static const char *MSG_DISCOVER = "DISCOVER";
esp_now_peer_info_t broadcastPeer_ = {0};

void onBroadcastReceive(const esp_now_recv_info_t *info, const uint8_t *data, int len)
{
  log_i("Received a message from " MACSTR " - len: %d - %.*s", MAC2STR(info->src_addr), len, len, data);
#if defined(DEVICE_TYPE_MASTER)
  if (memcmp(MSG_DISCOVER, data, len) == 0) {
    WIRELESS_Broadcast(String(MSG_DISCOVER) + "," + String(broadcastPeer_.channel));
  } else {
    DEVICES_UpdateInfo(data, len);
  }
#endif

#if defined(DEVICE_TYPE_SLAVE)
  if (memcmp(MSG_DISCOVER, data, strlen(MSG_DISCOVER)) == 0) {
    espnowDiscovered_ = true;

    String msg = String(data, len);
    uint8_t discovered_channel = 0;
    size_t commaIndex = msg.indexOf(',');

    if (commaIndex != -1) {
      String numStr = msg.substring(commaIndex + 1);
      int value = numStr.toInt();
      discovered_channel = value;
    } else {
      discovered_channel = broadcastPeer_.channel;
    }

    log_i("Discovered Channel: %d", discovered_channel);
    DB_SetEspNowChannel(discovered_channel);

    if (discovered_channel != broadcastPeer_.channel) {
      LocalModifyBroadcastPeer(discovered_channel);
    }
  } else {
    log_e("Unhandled message: %.*s", len, data);
  }
#endif
}

void OnDataSent(const esp_now_send_info_t *tx_info, esp_now_send_status_t status)
{
  if (status == ESP_NOW_SEND_SUCCESS) {

  } else {
    log_e("Send failed!");
  }
}

bool LocalModifyBroadcastPeer(uint8_t new_channel)
{
  broadcastPeer_.channel = new_channel;

  esp_err_t result = esp_now_mod_peer(&broadcastPeer_);
  if (result == ESP_OK) {
    log_i("Broadcast Peer channel changed to %d", new_channel);
  } else if (result == ESP_ERR_ESPNOW_NOT_INIT) {
    log_e("ESPNOW Not Init");
  } else if (result == ESP_ERR_ESPNOW_ARG) {
    log_e("Invalid Argument");
  } else if (result == ESP_ERR_ESPNOW_FULL) {
    log_e("Peer list full");
  } else if (result == ESP_ERR_ESPNOW_NO_MEM) {
    log_e("Out of memory");
  }
  
  return (result == ESP_OK);
}

bool LocalRegisterBroadcastPeer(const uint8_t *mac_addr, uint8_t channel)
{
  esp_err_t result;

  char macStr[18] = {0};
  snprintf(macStr, sizeof(macStr), "%02x:%02x:%02x:%02x:%02x:%02x",
           mac_addr[0], mac_addr[1], mac_addr[2], mac_addr[3], mac_addr[4], mac_addr[5]);

  if ( ! esp_now_is_peer_exist(mac_addr))
  {
    // Register peer
    memcpy(broadcastPeer_.peer_addr, mac_addr, ESP_NOW_ETH_ALEN);
    broadcastPeer_.channel = channel;  
    broadcastPeer_.encrypt = false;
    broadcastPeer_.ifidx = WIFI_IF_STA;

    // Add peer
    result = esp_now_add_peer(&broadcastPeer_);
    if (result != ESP_OK) {
      log_e("Failed to add peer %s", macStr);
      if (result == ESP_ERR_ESPNOW_NOT_INIT) {
        log_e("ESPNOW Not Init");
      } else if (result == ESP_ERR_ESPNOW_ARG) {
        log_e("Invalid Argument");
      } else if (result == ESP_ERR_ESPNOW_FULL) {
        log_e("Peer list full");
      } else if (result == ESP_ERR_ESPNOW_NO_MEM) {
        log_e("Out of memory");
      } else if (result == ESP_ERR_ESPNOW_EXIST) {
        log_e("Peer Exists");
      } else {
        log_e("Unknown error (%d - 0x%X)", result, result);
      }
    } else {
      log_i("Successfully add peer %s", macStr);
    }
  } else {
    log_w("Peer is already added %s", macStr);
  }

  return (result == ESP_OK);
}

#if defined(DEVICE_TYPE_SLAVE)
bool WIRELESS_IsDiscovered() {
  return espnowDiscovered_;
}

void WIRELESS_ChannelDiscoverLoop(byte channel_start)
{
  byte chn = channel_start;

  do {
    log_i("Discovering on channel %d", chn);
    {
      WiFi.setChannel(chn);
      LocalModifyBroadcastPeer(chn);
      WIRELESS_Broadcast((const uint8_t *)MSG_DISCOVER, strlen(MSG_DISCOVER));
      delay(2000);
      if (espnowDiscovered_) {
        break;
      }
    }

    chn++;
    if (chn > 11) {
      chn = 1;
    }
  } while (1);
}

void espnow_channel_discovery(void *param)
{
  WIRELESS_ChannelDiscoverLoop(broadcastPeer_.channel);
  vTaskDelete(NULL);
}
#endif

bool LocalEspnowSendData(const uint8_t *mac_addr, const uint8_t *data, size_t len)
{
  esp_err_t result = esp_now_send(mac_addr, data, len);

  if (result == ESP_OK) {

  } else if (result == ESP_ERR_ESPNOW_NOT_INIT) {
    log_e("ESPNOW not Init.");
  } else if (result == ESP_ERR_ESPNOW_ARG) {
    log_e("Invalid Argument");
  } else if (result == ESP_ERR_ESPNOW_INTERNAL) {
    log_e("Internal Error");
  } else if (result == ESP_ERR_ESPNOW_NO_MEM) {
    log_e("ESP_ERR_ESPNOW_NO_MEM");
  } else if (result == ESP_ERR_ESPNOW_NOT_FOUND) {
    log_e("Peer not found.");
  } else {
    log_e("Unknown error (%d - 0x%X)", result, result);
  }

  return (result == ESP_OK);
}

void WIRELESS_Init()
{
#if defined(DEVICE_TYPE_SLAVE)
  broadcastPeer_.channel = DB_GetEspNowChannel();
  log_i("WiFi Starting...");
  WiFi.mode(WIFI_STA);
  WiFi.setChannel(broadcastPeer_.channel);
  while (!WiFi.STA.started()) {
    delay(100);
  }

  log_i("WiFi Started! Parameters:");
  log_i("  MAC Address: " MACSTR " ", MAC2STR(WiFi.macAddress()));
  log_i("  ESPNOW Channel: %d", broadcastPeer_.channel);
#endif

#if defined(DEVICE_TYPE_MASTER)
  broadcastPeer_.channel = WiFi.channel();
#endif

  if (esp_now_init() != ESP_OK) {
    log_e("Error initializing ESP-NOW");
    while(1) { delay(500); }
    return;
  }

  esp_err_t err = esp_now_register_recv_cb(onBroadcastReceive);
  if (err != ESP_OK) {
    log_e("esp_now_register_recv_cb failed! 0x%x", err);
    return;
  }

  esp_now_register_send_cb(OnDataSent);

  LocalRegisterBroadcastPeer(_broadcastAddress, broadcastPeer_.channel);

  LED_SendCmd(LED_CMD_WIFI_CONNECTING);

#if defined(DEVICE_TYPE_SLAVE)
  if (xTaskCreate(espnow_channel_discovery, "espnow_channel_discovery", 4*1024, NULL, 1, NULL) == pdFALSE) {
    log_e("ESPNOW Channel Discover Create Task Failed!");
    delay(5000);
    ESP.restart();
  }
#endif
}

bool WIRELESS_Broadcast(const uint8_t *data, size_t len)
{
  LocalEspnowSendData(_broadcastAddress, data, len);
  return true;
}

bool WIRELESS_Broadcast(String msg)
{
  return WIRELESS_Broadcast((const uint8_t *)msg.c_str(), msg.length());
}

void WIRELESS_Task() {}

#if defined(DEVICE_TYPE_MASTER)
static void tcp_handler_task(void *param);

void LocalTcpSend(uint8_t cmd, uint8_t *data, uint16_t len, bool copy = true)
{
  if (_tcpQ)
  {
    QueueMsg_st msg = { cmd, data, len };
    if (copy && len) {
      msg.data = (uint8_t *)malloc(len);
      if (msg.data) {
        memcpy(msg.data, data, len);
      }
    }

    if (xQueueSend(_tcpQ, &msg, 0) != pdTRUE) {
      log_e("Send queue failed!");
      if (copy && len && msg.data) {
        free(msg.data);
        msg.data = NULL;
      }
    }
  }
}

void SERVER_Init()
{
  /* UDP Server */
  _udpServer.onPacket([](AsyncUDPPacket packet) {
    String packet_str = String((char *)packet.data(), packet.length());
    log_i("New packet: %s", packet_str.c_str());
    if (packet.length() == strlen(udp_broadcast_msg)) {
      if (strncmp((const char *)packet.data(), udp_broadcast_msg, packet.length()) == 0) {
        _udpServer.writeTo((const uint8_t *)udp_response_msg, strlen(udp_response_msg), packet.localIP(), CONFIG_UDP_CLIENT_PORT);
      }
    }
  });

  _udpServer.listen(CONFIG_UDP_SERVER_PORT);
  log_i("UDP Server listening on port %d", CONFIG_UDP_SERVER_PORT);

  /* TCP Server */
  _tcpServer.onClient([] (void *arg, AsyncClient *client) {
    log_i("New client connected! IP: "MACSTR" ", MAC2STR(client->remoteIP()));
    _tcpClient = client;

    client->onDisconnect([](void *arg, AsyncClient *client) {
      log_i("** client has been disconnected: %" PRIu16 "", client->localPort());
      _tcpClient = nullptr;
      client->close(true);
      delete client;
    });

    client->onData([](void *arg, AsyncClient *client, void *data, size_t len) {
      log_d("** data received by client: %" PRIu16 ": len=%u", client->localPort(), len);
      log_d("%*s", len, data);
      // SENSOR_HandleTcpMsg((uint8_t *)data, len);
    });
  }, NULL);

  if (_tcpQ == NULL) {
    _tcpQ = xQueueCreate(TCP_QUEUE_SIZE, sizeof(QueueMsg_st));
  }

  if (_tcpTaskHdl == NULL) {
    xTaskCreate(tcp_handler_task, "tcp_handler_task", 8192, NULL, 1, &_tcpTaskHdl);
  }

  _tcpServer.begin();
}

void SERVER_Send(String &msg)
{
  if (_tcpClient) {
    if ( ! _tcpClient->write(msg.c_str())) {
      log_e("TCP Write failed!");
    } else {
      log_i("Sent: %s", msg.c_str());
    }
  }
}

void LocalSendTcpResponse(bool ret)
{
  String response = String("{\"message\":\"") + (ret? String("success") : String("failed")) + String("\"}");
  SERVER_Send(response);
}

void tcp_handler_task(void *param)
{
  QueueMsg_st msg;

  while (1)
  {
    if (xQueueReceive(_tcpQ, &msg, portMAX_DELAY) == pdTRUE)
    {
      if (msg.data && msg.len)
      {
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, msg.data, msg.len);

        if (error == DeserializationError::Ok) {
          
        }
      }

      /* Free resources */
      if (msg.data)
      {
        free(msg.data);
        msg.data = NULL;
      }
      msg.len = 0;
    }
  }
}

void wifi_ap_task(void *param)
{
  while (1) {
    WIFI_AP_ServerLoop();
    delay(1);
  }
}

bool WIFI_ValidateWifiCredentials(String &ssid, String &pass)
{
  return ! (ssid.length() < 4 || ((0 < pass.length() && pass.length() < 8)));
}

void WIFI_AccessPoint()
{
  LED_SendCmd(LED_CMD_AP_MODE);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(CONFIG_WIFI_AP_SSID, CONFIG_WIFI_AP_PASSWORD, 6);
  log_i("Access Point IP: %s", WiFi.softAPIP().toString().c_str());

  _apServer.on("/", []() {
    _apServer.send(200, "text/html", index_html);
  });

  _apServer.on("/settings", HTTP_POST, []() {
    String ssid = _apServer.arg("ssid");
    String pass = _apServer.arg("password");
    log_i("Username: %s - Password: %s", ssid.c_str(), pass.c_str());

    DB_SetWifiCredentials(ssid, pass);
    _apServer.send(200, "text/plain", "Successful");
    vTaskDelay(pdMS_TO_TICKS(500));
    ESP.restart();
  });

  _apServer.begin();

  if (xTaskCreate(wifi_ap_task, "wifi_ap_task", 8*1024, NULL, 1, NULL) == pdFALSE) {
    log_e("WiFi AP Create Task Failed!");
    delay(5000);
    ESP.restart();
  }
}

void WIFI_Init()
{
  String ssid, pass;
  DB_GetWifiCredentials(ssid, pass);

  if (WIFI_ValidateWifiCredentials(ssid, pass))
  {
    log_i("Connecting to WiFi: %s - %s", ssid.c_str(), pass.c_str());
    LED_SendCmd(LED_CMD_WIFI_CONNECTING);

    unsigned long connect_time = millis();
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, pass);
    while (WiFi.status() != WL_CONNECTED) {
      delay(1000);
      if (millis() - connect_time >= CONFIG_WIFI_CONNECT_TIMEOUT) {
        log_e("WiFi Connect Failed! Goto Access Point mode!");
        WIFI_AccessPoint();
        break;
      }
    }

    if (WiFi.status() == WL_CONNECTED) {
      LED_SendCmd(LED_CMD_OFF);
      log_i("WiFi Connected. IP: %s - Channel: %d", WiFi.localIP().toString().c_str(), WiFi.channel());
      SERVER_Init();
    }
  }
  else
  {
    log_e("Invalid WiFi Credentials! Goto Acccess Point mode!");
    WIFI_AccessPoint();
  }
}

void WIFI_AP_ServerLoop() {
  if (WiFi.getMode() == WIFI_AP) {
    _apServer.handleClient();
  }
}
#endif
