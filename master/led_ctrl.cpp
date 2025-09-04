#include "common.h"

#define LED_CTRL_QUEUE_SIZE                   16
#define LED_ON                                LOW
#define LED_OFF                               HIGH

typedef enum {
  LED_COLOR_OFF = (0),
  LED_COLOR_BLUE,
  LED_COLOR_WHITE,
  LED_COLOR_GREEN,
  LED_COLOR_RED,
  LED_COLOR_PINK,
  LED_COLOR_YELLOW,
  LED_COLOR_MAX
} LedColor_e;

typedef struct {
  LedCtrlCmd_e cmd;
} LedCtrlMsg_st;

static QueueHandle_t _ledCtrlQ = nullptr;
static TaskHandle_t _ledCtrlTaskHdl = nullptr;
static std::vector<LedCtrlCmd_e> _ledCmdQueue;

static void led_ctrl_task(void *arg);
static void LocalLedBlink(uint32_t time, bool init = false);

static void LocalLedOff()
{
  digitalWrite(CONFIG_BUILTIN_LED_PIN, LED_OFF);
}

static void LocalLedOn()
{
  digitalWrite(CONFIG_BUILTIN_LED_PIN, LED_ON);
}

static void LocalLedBlink(uint32_t time, bool init)
{
  static unsigned long blink_time = 0;
  static uint8_t led_state = LED_OFF;

  if (init) {
    led_state = LED_OFF;
    blink_time = 0;
  }

  if (millis() - blink_time > time) {
    blink_time = millis();
    led_state = !led_state;
    if (led_state == LED_ON) {
      LocalLedOn();
    } else {
      LocalLedOff();
    }
  }
}

void LED_Init()
{
  pinMode(CONFIG_BUILTIN_LED_PIN, OUTPUT);
  LocalLedOn();

  if (_ledCtrlQ == nullptr) {
    _ledCtrlQ = xQueueCreate(LED_CTRL_QUEUE_SIZE, sizeof(LedCtrlMsg_st));
    if (_ledCtrlQ == nullptr) {
      log_e("LED Control Queue Create Failed!");
    } else {
      if (_ledCtrlTaskHdl == nullptr) {
        if (xTaskCreate(led_ctrl_task, "led_ctrl_task", 8*1024, NULL, 1, &_ledCtrlTaskHdl) == pdFALSE) {
          log_e("LED Control Create Task Failed!");
        }
      }
    }
  }

  LED_SendCmd(LED_CMD_STARTUP);
}

void LED_SendCmd(LedCtrlCmd_e cmd)
{
  if (_ledCtrlQ) {
    LedCtrlMsg_st msg = { .cmd = cmd };
    if (xQueueSend(_ledCtrlQ, &msg, 0) != pdTRUE) {
      log_e("Send queue failed!");
    }
  }
}

bool LocalCheckBlockingLed(LedCtrlCmd_e &state)
{
  bool ret = false;

  switch (state)
  {
    case LED_CMD_WIFI_CONNECTED:
      ret = true;
      break;

    default: break;
  }

  return ret;
}

void LocalCheckLedCmdQueue()
{
  if (_ledCmdQueue.size() > 0)
  {
    LedCtrlCmd_e cmd = _ledCmdQueue.at(0);
    _ledCmdQueue.erase(_ledCmdQueue.begin());
    LED_SendCmd(cmd);
  }
}

void led_ctrl_task(void *arg)
{
  LedCtrlMsg_st msg;
  LedCtrlCmd_e state = LED_CMD_MAX, prevState = LED_CMD_MAX;
  unsigned long led_time = 0;
  uint8_t led_state = LED_OFF;

  while (1)
  {
    if (xQueueReceive(_ledCtrlQ, &msg, 0) == pdTRUE)
    {
      if (LocalCheckBlockingLed(state))
      {
        _ledCmdQueue.push_back(msg.cmd);
        continue;
      }

      state = msg.cmd;
      switch (state)
      {
        case LED_CMD_WIFI_CONNECTED:
          led_time = millis();
          break;

        case LED_CMD_WIFI_FAILED:
          led_time = millis();
          break;

        case LED_CMD_OFF:
          LocalLedOff();
          break;

        case LED_CMD_AP_MODE:
          LocalLedOn();
          break;

        case LED_CMD_POWER_OFF:
          led_time = millis();
          break;

        default:
          break;
      }
    }

    /* Main operation */
    switch (state)
    {
      case LED_CMD_STARTUP:
      case LED_CMD_WIFI_CONNECTING:
        LocalLedBlink(500);
        break;

      case LED_CMD_WIFI_CONNECTED:
        if (millis() - led_time > 2000) {
          LocalLedOff();
          state = LED_CMD_MAX;
        }
        break;

      case LED_CMD_WIFI_FAILED:
        if (millis() - led_time > 2000) {
          LocalLedOff();
          state = LED_CMD_MAX;
        }
        break;

      case LED_CMD_POWER_OFF:
        LocalLedBlink(100);
        break;

      default:
        break;
    }

    if (prevState != state)
    {
      prevState = state;
      if (state == LED_CMD_MAX)
      {
        LocalCheckLedCmdQueue();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

