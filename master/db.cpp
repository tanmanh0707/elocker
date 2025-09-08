#include "common.h"

#define PREF_NAME_SETTINGS                          "settings"
#define PREF_KEY_WIFI_SSID                          "wifi-ssid"
#define PREF_KEY_WIFI_PASSWORD                      "wifi-password"
#define PREF_KEY_ESPNOW_CHANNEL                     "espnow-channel"

#define PREF_READONLY                               true
#define PREF_READWRITE                              false

static Preferences _pref;

uint8_t DB_GetEspNowChannel()
{
  uint8_t channel;
  _pref.begin(PREF_NAME_SETTINGS, PREF_READONLY);
  channel = _pref.getUChar(PREF_KEY_ESPNOW_CHANNEL, 1);
  _pref.end();
  log_i("%d", channel);

  return channel;
}

void DB_SetEspNowChannel(uint8_t new_channel)
{
  uint8_t db_channel = DB_GetEspNowChannel();
  if (db_channel != new_channel) {
    _pref.begin(PREF_NAME_SETTINGS, PREF_READWRITE);
    _pref.putUChar(PREF_KEY_ESPNOW_CHANNEL, new_channel);
    _pref.end();

    log_i("DB Set channel: %d", new_channel);
  }
}

void DB_GetWifiCredentials(String &ssid, String &password)
{
  _pref.begin(PREF_NAME_SETTINGS, PREF_READONLY);
  ssid = _pref.getString(PREF_KEY_WIFI_SSID);
  password = _pref.getString(PREF_KEY_WIFI_PASSWORD);
  _pref.end();

  log_i("WiFi Credentials: %s - %s", ssid.c_str(), password.c_str());
}

void DB_SetWifiCredentials(String &ssid, String &password)
{
  String db_ssid, db_password;
  DB_GetWifiCredentials(db_ssid, db_password);
  
  if (db_ssid != ssid || db_password != password)
  {
    _pref.begin(PREF_NAME_SETTINGS, PREF_READWRITE);
    _pref.putString(PREF_KEY_WIFI_SSID, ssid);
    _pref.putString(PREF_KEY_WIFI_PASSWORD, password);
    _pref.end();
    log_i("WiFi Credentials Saved: %s - %s", ssid.c_str(), password.c_str());
  }
}
