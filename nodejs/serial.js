const { SerialPort } = require("serialport");
const http = require("http");
const readline = require("readline");

const SENSOR_STATUS_NOT_CHARGE = 0;
const SENSOR_STATUS_CHARGING = 1;
const SENSOR_STATUS_FULL_CHARGED = 2;
const SENSOR_FULL_CHARGED_DELAY = 5;

const CU_DEVICE_ID = 0;

var MESS_CU_TEMP = [0x02, 0x00, 0x30, 0x03, 0x35];
var sensorThreshold = 200;  //mA
var cuPort;
var ssPort;

function  delay(time){
  return new Promise((resolve) => setTimeout(resolve, time))
}

// ===== CRC16 (Modbus) =====
function crc16(buf) {
  let crc = 0xFFFF;
  for (let b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }
  return crc & 0xFFFF;
}

function cuLockCheckSum(arr) {
    let sum = 0;
    for (let i of arr) {
        sum += i;
    }
    return sum & 0xff;
}

function crc16_modbus(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xFFFF;
}

function dumpArrayHex(header, arr) {
  console.log(header, arr.toString('hex').match(/.{1,2}/g).join(' '));
}

function buildCuLockGetStatusMessage(cu_id) {
  let MESS_CU = [...MESS_CU_TEMP];
  MESS_CU[2] = 0x30;
  MESS_CU[1] = (cu_id << 4) | 0;
  let mess_sum = MESS_CU.slice(0, MESS_CU.length - 1);
  MESS_CU[4] = cuLockCheckSum(mess_sum);
  return Buffer.from(MESS_CU);
}

function buildCuLockOpenMessage(deviceId, lockId) {
	let MESS_CU = [...MESS_CU_TEMP];
	MESS_CU[1]=(deviceId<<4)|(lockId - 1);
	MESS_CU[2]=0x31;
	let mess_sum=MESS_CU.slice(0,MESS_CU.length-1);
	MESS_CU[4]=cuLockCheckSum(mess_sum);
	return Buffer.from(MESS_CU);
}

function buildPacket(id, cmd, data) {
  data = data || []; // có thể null
  const len = 4 + data.length; // ID + CMD + DATA
  const payload = [len, id, cmd, ...data];

  const crc = crc16_modbus(Buffer.from(payload));
  const crc_h = (crc >> 8) & 0xFF;
  const crc_l = crc & 0xFF;

  return Buffer.from([0x02, ...payload, crc_h, crc_l, 0x03]);
}

function validateSensorPacket(packet) {
  if (packet.length < 6) {
    if (packet.length > 0) {
      dumpArrayHex("❌ [SENSOR] Invalid length:", packet);
    } else {
      console.log("❌ Packet length = 0");
    }
    return false;
  }

  const stx = packet[0];
  const etx = packet[packet.length - 1];

  if (stx !== 0x02 || etx !== 0x03) {
    console.log("❌ [SENSOR] Wrong STX/ETX");
    return false;
  }

  const len = packet[1];
  if (packet.length !== len + 3) {
    console.log(`❌ Wrong packet length: packet=${packet.length}, len=${len}`);
    //return false;
  }

  // CRC
  const crcLow = packet[packet.length - 2];
  const crcHigh = packet[packet.length - 3];
  const recvCrc = (crcHigh << 8) | crcLow;

  // from len to data
  const dataForCrc = packet.slice(1, packet.length - 3);
  const calcCrc = crc16(dataForCrc);

  // console.log("🔎 Debug Packet:");
  // console.log("  Raw:", [...packet].map(b => b.toString(16).padStart(2,"0")).join(" "));
  // console.log("  LEN:", len);
  // console.log("  CRC recv:", recvCrc.toString(16), " (hi:", crcHigh.toString(16), " lo:", crcLow.toString(16), ")");
  // console.log("  CRC calc:", calcCrc.toString(16));

  if (recvCrc !== calcCrc) {
    console.log("❌ CRC mismatch!");
    return false;
  }

  return true;
}


function questionAsync(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
}

function parseSensorDevices(byteArray) {
  if (!byteArray || byteArray.length < 1) return [];

  const buf = Buffer.from(byteArray);
  const deviceCount = buf[0];
  const devices = [];

  for (let i = 0; i < deviceCount; i++) {
    let start = 1 + i * 9;
    if (start + 9 > buf.length) {
      console.log("❌ Invalid packet length:", buf.length);
      break; // out of range
    }

    let deviceId = buf[start];
    let current = Math.round(Math.abs(buf.readFloatLE(start + 1))) >>> 0; // mA
    let voltage = Math.round(Math.abs(buf.readFloatLE(start + 5))) >>> 0; // V

    devices.push({
      id: deviceId,
      mA: current,
      V: voltage
    });
  }

  return devices;
}

function getSensorStatus(current_mA) {
  if (current_mA < 10) {
    return SENSOR_STATUS_NOT_CHARGE;
  } else if (current_mA < sensorThreshold) {
    return SENSOR_STATUS_FULL_CHARGED;
  } else {
    return SENSOR_STATUS_CHARGING;
  }
}

function getSensorStatusString(status) {
  if (status === SENSOR_STATUS_NOT_CHARGE) {
    return "notcharge";
  } else if (status === SENSOR_STATUS_FULL_CHARGED) {
    return "fullcharged";
  } else {
    return "charging";
  }
}

function cuLockOpen(cu_id, lock_id) {
  let cuMsg = buildCuLockOpenMessage(cu_id, lock_id);

  cuPort.write(cuMsg, (err) => {
    if (err) {
      console.error("Send failed:", err.message);
    } else {
      dumpArrayHex('[CU][TX]', cuMsg);
    }
  });
}

function cuLockStatus(cu_id) {
  let cuMsg = buildCuLockGetStatusMessage(cu_id);

  cuPort.write(cuMsg, (err) => {
    if (err) {
      console.error("Send failed:", err.message);
    }
  });
}

async function handleSensorDevice(devices) {
  console.log("Devices:", devices);

  for (let dev of devices) {
    let status = getSensorStatus(dev.mA);
    if (status == SENSOR_STATUS_FULL_CHARGED && dev.full_cnt >= SENSOR_FULL_CHARGED_DELAY) {
      if (dev.lock === true) {
        cuLockOpen(CU_DEVICE_ID, dev.id);
        await delay(250);
        cuLockStatus(CU_DEVICE_ID);
      }
    }
  }
}

async function main() {
  var sensorDevices = []

  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log("⚠️ No COM Port found");
    return;
  }

  console.log("COM port list:");
  ports.forEach((p, idx) => {
    console.log(`${idx + 1}) ${p.path} ${p.friendlyName || ""}`);
  });

  let cuPortIdx = 0;
  do {
    const ans = await questionAsync("Select CU Lock COM port: ");
    cuPortIdx = Number(ans.trim()) - 1;
    if (cuPortIdx < 0 || cuPortIdx >= ports.length) {
      console.log("❌ Invalid selection");
    }
  } while (cuPortIdx < 0 || cuPortIdx >= ports.length);

  let ssPortIdx = 0;
  do {
    const ans = await questionAsync("Select Sensor COM port: ");
    ssPortIdx = Number(ans.trim()) - 1;
    if (ssPortIdx < 0 || ssPortIdx >= ports.length) {
      console.log("❌ Invalid selection");
    } else if (ssPortIdx == cuPortIdx) {
      console.log(ports[cuPortIdx].path, "has been selected by CU Lock");
    }
  } while (ssPortIdx < 0 || ssPortIdx >= ports.length || ssPortIdx == cuPortIdx);

  let recvBuffer = Buffer.alloc(0);
  let sensorResolver = null;
  let sensorTimeoutHdl = null;

  const cuPath = ports[cuPortIdx].path;
  const ssPath = ports[ssPortIdx].path;
  const cuBaud = 19200;
  const ssBaud = 115200;
  cuPort = new SerialPort({ path: cuPath, baudRate: cuBaud, autoOpen: false });
  ssPort = new SerialPort({ path: ssPath, baudRate: ssBaud, autoOpen: false });

  ssPort.on("data", (chunk) => {
    dumpArrayHex("[RX] [SENSOR]", chunk)

    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 7) {
      const stx = recvBuffer.indexOf(0x02);
      if (stx === -1) break;
      if (recvBuffer.length < recvBuffer[1] + 3) {
        console.log("Invalid length: recvBuffer[1]:", recvBuffer[1], "- recv len:", recvBuffer.length);
        break;
      }

      const packet = recvBuffer.subarray(stx, recvBuffer[1] + 3);
      if (validateSensorPacket(packet)) {
        let tmpDevices = parseSensorDevices(packet.subarray(2));

        tmpDevices.forEach(dev => {
          let found = sensorDevices.find(o => o.id === dev.id);
          if (found) {
            if (dev.mA < sensorThreshold && dev.mA > 10) {
              found.full_cnt++;
            } else {
              found.full_cnt = 0;
            }
            found.mA = dev.mA;
            found.V = dev.V;
          } else {
            sensorDevices.push({
              ...dev,
              lock: false,
              full_cnt: 0
            });
          }
        });

        handleSensorDevice(sensorDevices);
        recvBuffer = recvBuffer.subarray(recvBuffer[1] + 3);
      } else {
        dumpArrayHex("❌ [SENSOR] Validate failed", packet);
      }
    }
  });

  ssPort.on("open", () => console.log(`✅ [SENSOR] Opened ${ssPath} @${ssBaud}`));
  ssPort.on("error", (err) => console.error("⚠️ [SENSOR] Error:", err.message));

  /* Init CU Lock COM port */
  cuPort.on("data", (data) => {
    if (data.length > 0 && data[0] === 0x02 && data[1] === CU_DEVICE_ID && data[2] === 0x35) {
      let status = (data[4] << 8) | (data[3])

      for (let dev_id = 0; dev_id < 16; dev_id++) {
        let lock_stt = ((status >> dev_id) & 1) === 1? true : false;
        let found = sensorDevices.find(o => o.id === dev_id + 1);
        if (found) {
          if (found.lock !== lock_stt) {
            console.log("[CU][" + dev_id + "]", lock_stt? "true" : "false");
            found.lock = lock_stt;
          }
        }
      }
    } else {
      dumpArrayHex("❌ [CU][RX]:", data);
    }
  });

  cuPort.on("open", () => console.log(`✅ [CU] Opened ${cuPath} @${cuBaud}`));
  cuPort.on("error", (err) => console.error("⚠️ [CU] Error:", err.message));

  await new Promise((res, rej) => ssPort.open((err) => (err ? rej(err) : res())));
  await new Promise((res, rej) => cuPort.open((err) => (err ? rej(err) : res())));

  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/getStatus") {
      let results = [];

      for (let dev of sensorDevices) {   
        let statusStr = getSensorStatusString(getSensorStatus(dev.mA));
        results.push({ id: dev.id, mA: dev.mA, V: dev.V, status: statusStr, lock: dev.lock });
      }

	    console.log(results);
      const json = JSON.stringify({ results }, null, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(json);
    }
    else if (req.method === "POST" && req.url === "/setThreshold") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          const threshold = data.threshold;
          if (typeof threshold !== "number") {
            res.writeHead(400);
            res.end("Invalid threshold");
          } else {
            sensorThreshold = threshold;
            console.log("✅ Threshold set to", sensorThreshold, "(mA)")
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: 'success' }, null, 2));
          }
		    } catch (e) {
          res.writeHead(400);
          res.end("Invalid JSON");
        }
      });
    }
    else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  setInterval(() => {
    cuLockStatus(CU_DEVICE_ID);
  }, 2000);

  const PORT_HTTP = 3000;
  server.listen(PORT_HTTP, () => {
    console.log(`🌐 HTTP server listening on http://localhost:${PORT_HTTP}`);
  });
}

main();
