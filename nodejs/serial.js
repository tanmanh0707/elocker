const { SerialPort } = require("serialport");
const http = require("http");
const readline = require("readline");

const CMD_GET_CURRENT_mA = 0x00;
const CMD_SET_THRESHOLD = 0x01;
const ID_BROADCAST = 0x00;

const SENSOR_STATUS_NOT_CHARGE = 0;
const SENSOR_STATUS_CHARGING = 1;
const SENSOR_STATUS_FULL_CHARGED = 2;

const CU_DEVICE_ID = 0;

var sensorThreshold = 200;  //mA

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

function buildCuLockGetStatusMessage() {
  let MESS_CU = [...MESS_CU_TEMP];
  MESS_CU[2] = 0x30;
  MESS_CU[1] = (deviceId << 4) | 0;
  let mess_sum = MESS_CU.slice(0, MESS_CU.length - 1);
  MESS_CU[4] = cuLockCheckSum(mess_sum);
  return Buffer.from(MESS_CU);
}

function buildCuLockOpenMessage(deviceId, lockId) {
	let MESS_CU = [...MESS_CU_TEMP];
	MESS_CU[1]=(deviceId<<4)|(lockId);
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
    console.log("❌ [SENSOR] Packet length error: ", packet.length, "(bytes)");
    return false;
  }

  const stx = packet[0];
  const etx = packet[packet.length - 1];

  if (stx !== 0x02 || etx !== 0x03) {
    console.log("❌ [SENSOR] Wrong STX/ETX");
    return false;
  }

  const len = packet[1];
  if (packet.length !== len + 5) {
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
    let current = buf.readUInt32LE(start + 1); // mA
    let voltage = buf.readUInt32LE(start + 5); // V

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

function handleSensorDevice(devices) {
  console.log("Devices:", devices);

  for (let dev of devices) {
    let status = getSensorStatus(dev.mA);
    if (status == SENSOR_STATUS_FULL_CHARGED) {
      let cuOpenMsg = buildCuLockOpenMessage(CU_DEVICE_ID, dev.id);

      cuPort.write(msg, (err) => {
        if (err) {
          console.error("Send failed:", err.message);
        } else {
          console.log("TX:", msg.toString('hex').match(/.{1,2}/g).join(' '));
        }
      });
    }
  }
}

async function main() {
  var sensorDevices = [{id: 0, mA: 0, V: 0}]

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
  const cuPort = new SerialPort({ path: cuPath, baudRate: cuBaud, autoOpen: false });
  const ssPort = new SerialPort({ path: ssPath, baudRate: ssBaud, autoOpen: false });

  ssPort.on("data", (chunk) => {
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 7) {
      const stx = recvBuffer.indexOf(0x02);
      const etx = recvBuffer.indexOf(0x03, stx + 1);
      if (stx === -1 || etx === -1) break;

      const packet = recvBuffer.subarray(stx, etx + 1);
      recvBuffer = recvBuffer.subarray(etx + 1);

      if (validateSensorPacket(packet)) {
        sensorDevices = parseSensorDevices(packet.subarray(2));
        handleSensorDevice(sensorDevices);
      } else {
        const hexArray = [...chunk].map(b => b.toString(16).padStart(2, "0"));
        console.log("[RX] [SENSOR] CRC failed:", hexArray.join(" "));
      }
    }
  });

  ssPort.on("open", () => console.log(`✅ [SENSOR] Opened ${ssPath} @${ssBaud}`));
  ssPort.on("error", (err) => console.error("⚠️ [SENSOR] Error:", err.message));

  /* Init CU Lock COM port */
  cuPort.on("data", (chunk) => {
    console.log("[CU][RX]:", data.toString('hex').match(/.{1,2}/g).join(' '));
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
  });

  cuPort.on("open", () => console.log(`✅ [CU] Opened ${ssPath} @${ssBaud}`));
  cuPort.on("error", (err) => console.error("⚠️ [CU] Error:", err.message));

  await new Promise((res, rej) => ssPort.open((err) => (err ? rej(err) : res())));
  await new Promise((res, rej) => cuPort.open((err) => (err ? rej(err) : res())));

  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/getStatus") {
      let results = [];

      for (let dev of sensorDevices) {   
        let statusStr = getSensorStatusString(getSensorStatus(dev.mA));
        results.push({ id, mA: dev.mA, status: statusStr });
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

  const PORT_HTTP = 3000;
  server.listen(PORT_HTTP, () => {
    console.log(`🌐 HTTP server listening on http://localhost:${PORT_HTTP}`);
  });
}

main();
