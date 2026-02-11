#include "common.h"

#define RS485_RX                  3
#define RS485_TX                  4

#define UART_PORT                 UART_NUM_1
#define UART_BUFF_SIZE            1024
#define UART_FRAME_TIMEOUT        100
#define UART_PROTOCOL_BROADCAST   0x00

#define STX                       0x02
#define ETX                       0x03
#define UART_PROTOCOL_CRC_LEN     2       //bytes

typedef enum {
  UART_STATE_IDLE = (0),
  UART_STATE_LEN,
  UART_STATE_DATA,
  UART_STATE_ETX,
} UartStates_e;

typedef enum {
  UART_CMD_GET_CURRENT_mA = (0),
  UART_CMD_SET_THRESHOLD,
} UartCmds_e;

typedef enum {
  UART_TYPE_READ = (0),
  UART_TYPE_WRITE
} UartTypes_e;

static QueueHandle_t _uartQueue;
static UartStates_e _uartState = UART_STATE_IDLE;

static void LocalHandleIncommingData(uint8_t *data, uint16_t data_len);

uint16_t LocalCalculateCrc16(uint8_t *data, uint16_t data_len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < data_len; i++) {
    crc ^= data[i];
    for (int j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc;
}

static void uart_event_task(void *pvParameters)
{
  uart_event_t event;
  uint8_t recv_data[UART_BUFF_SIZE];
  uint8_t *pData = NULL;
  uint16_t data_cnt = 0, data_len = 0;
  unsigned long timeout = 0;

  while (1) {
    if (xQueueReceive(*(QueueHandle_t*)pvParameters, (void *)&event, (_uartState == UART_STATE_IDLE)? portMAX_DELAY : pdMS_TO_TICKS(UART_FRAME_TIMEOUT))) {
      switch (event.type) {
        case UART_DATA: {
          int len = uart_read_bytes(UART_PORT, recv_data, event.size, portMAX_DELAY);
          for (int i = 0; i < len; i++)
          {
            log_d("%02X", recv_data[i]);
            switch (_uartState)
            {
              case UART_STATE_IDLE:
                if (recv_data[i] == STX) {
                  if (pData) {
                    free(pData);
                    pData = NULL;
                  }
                  _uartState = UART_STATE_LEN;
                }
                break;
              case UART_STATE_LEN:
                data_len = recv_data[i];
                if (data_len > UART_PROTOCOL_CRC_LEN) {
                  pData = (uint8_t *)malloc(data_len);
                  if (pData) {
                    data_cnt = 0;
                    _uartState = UART_STATE_DATA;
                  } else {
                    log_e("Failed to allocate memory: %d (bytes)", data_len);
                    _uartState = UART_STATE_IDLE;
                  }
                } else {
                  log_e("Invalid data length: %d", data_len);
                  _uartState = UART_STATE_IDLE;
                }
                break;
              case UART_STATE_DATA:
                pData[data_cnt++] = recv_data[i];
                if (data_cnt >= data_len) {
                  _uartState = UART_STATE_ETX;
                }
                break;
              case UART_STATE_ETX:
                if (recv_data[i] == ETX) {
                  LocalHandleIncommingData(pData, data_len);
                } else {
                  log_e("Invalid ETX: 0x%X", recv_data[i]);
                }

                _uartState = UART_STATE_IDLE;
                break;
              default: break;
            }

            timeout = millis();
          }
          break;
        }
        default:
          break;
      }
    }
    else
    {
      if (_uartState != UART_STATE_IDLE) {
        log_e("Timeout!");
        _uartState = UART_STATE_IDLE;
      }
    }
  }
}

bool UART_SendBytes(uint8_t *data, uint16_t data_len)
{
  int sent_len = 0;
  uint16_t packet_len = data_len + 5;
  uint8_t *packet = (uint8_t *)malloc(packet_len);
  if (packet) {
    packet[0] = STX;
    packet[1] = data_len + 2;  //ID and CRC16
    // packet[2] = DEVICE_ID;
    memcpy(&packet[2], data, data_len);
    uint16_t crc = LocalCalculateCrc16(&packet[1], data_len + 1);
    packet[packet_len - 3] = crc >> 8;
    packet[packet_len - 2] = crc & 0xFF;
    packet[packet_len - 1] = ETX;
    // sent_len = uart_write_bytes(UART_PORT, packet, packet_len);
    sent_len = Serial.write(packet, packet_len);

    free(packet);
  }

  return (sent_len == packet_len);
}

bool UART1_SendBytes(uint8_t *data, uint16_t data_len)
{
  int sent_len = 0;
  uint16_t packet_len = data_len + 6; //STX - LEN - ID - (DATA) - CRC_H - CRC_L - ETX
  uint8_t *packet = (uint8_t *)malloc(packet_len);
  if (packet) {
    packet[0] = STX;
    packet[1] = data_len + 3;  //ID and CRC16
    packet[2] = DB_GetDeviceId();
    memcpy(&packet[3], data, data_len);
    uint16_t crc = LocalCalculateCrc16(&packet[1], data_len + 2);
    packet[packet_len - 3] = crc >> 8;
    packet[packet_len - 2] = crc & 0xFF;
    packet[packet_len - 1] = ETX;
    sent_len = uart_write_bytes(UART_PORT, packet, packet_len);

    free(packet);
  }

  return (sent_len == packet_len);
}

void LocalHandleIncommingData(uint8_t *data, uint16_t data_len)
{
  if (data_len > 1) {
    uint8_t id = data[0];
    UartCmds_e cmd = (UartCmds_e)data[1];

    if (id == UART_PROTOCOL_BROADCAST || id == DB_GetDeviceId())
    {
      switch (cmd)
      {
        case UART_CMD_GET_CURRENT_mA:
        {
          log_i("Get Current mA");
          float current_mA = SENSOR_GetCurrent_mA();
          float busVoltage = SENSOR_GetVoltage();
          bool smoke_detected = SENSOR_SMOKE_Detected();
          bool fire_detected = SENSOR_FIRE_Detected();
          int buffer_size = sizeof(float) * 2 + 2;  //mA(float) + vol(float) + smoke(bool) + fire(bool)
          uint8_t buffer[buffer_size] = { 0 };
          uint8_t pos = 0;
          memcpy(buffer, (uint8_t *)&current_mA, sizeof(float)); pos += sizeof(float);
          memcpy(&buffer[pos], (uint8_t *)&busVoltage, sizeof(float)); pos += sizeof(float);
          buffer[pos] = smoke_detected? 1 : 0; pos++;
          buffer[pos] = fire_detected? 1 : 0;
          UART1_SendBytes(buffer, buffer_size);
        }
          break;

        case UART_CMD_SET_THRESHOLD:
          log_i("Set threshold");
          break;

        default: break;
      }
    }
  }
}

void UART_Init()
{
  _uartQueue = xQueueCreate(1024, sizeof(char));

  const uart_config_t uart_config = {
      .baud_rate = 115200,
      .data_bits = UART_DATA_8_BITS,
      .parity    = UART_PARITY_DISABLE,
      .stop_bits = UART_STOP_BITS_1,
      .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
      .source_clk = UART_SCLK_DEFAULT,
  };

  ESP_ERROR_CHECK(uart_driver_install(UART_PORT, UART_BUFF_SIZE, UART_BUFF_SIZE, 20, &_uartQueue, ESP_INTR_FLAG_SHARED));
  ESP_ERROR_CHECK(uart_param_config(UART_PORT, &uart_config));
  ESP_ERROR_CHECK(uart_set_pin(UART_PORT, RS485_RX, RS485_TX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

  xTaskCreate(uart_event_task, "uart_event_task", 4096, &_uartQueue, 12, NULL);
}
