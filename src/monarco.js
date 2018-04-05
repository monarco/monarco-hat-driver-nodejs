'use strict';
/*jshint bitwise: false*/

var spi = require('spi-device');
var CRC = require('crc');
var events = require('events');
var Led = require('./led.js');
var RxData = require('./rxdata.js');
var SvcCommand = require('./svc_cmd.js');
var SDC_CONSTANTS = require('./sdc_constants.js');

class Monarco extends events.EventEmitter {
	constructor() {
		super();

		this.SDC = SDC_CONSTANTS;

		this._period = 70; // x[ms], 100ms is limit to activate watchdog		

		this.LEDs = [];
		for (let i = 0; i < 8; i++) {
			this.LEDs[i] = new Led();
		}

		this.digitalOutputs = [false, false, false, false];
		this.analogOutputs = [0, 0]; // 0 - 10[V]

		this.analogInputsInVoltageMode = [];
		this.analogInputsInVoltageMode[0] = true;
		this.analogInputsInVoltageMode[1] = true;

		this.pwm1a = 0; // 0-1
		this.pwm1b = 0; // 0-1
		this.pwm1c = 0; // 0-1
		this.pwm2a = 0; // 0-1

		this.pwm1Freq = 0;
		this.pwm2Freq = 0;

		this.ain1Mode = 1; // 1 -> 0-10[V]; 2 -> 0-20[mA]
		this.ain2Mode = 1; // 1 -> 0-10[V]; 2 -> 0-20[mA]
		this.inService = 0;
		this.rs485_baudrate = 9600;
		this.rs485_parity = 1; // 1:none; 2:even; 3:odd
		this.rs485_stopbits_mode = 2; // 1: 0.5bit; 2: 1bit; 3: 1.5bit; 4: 2bit
		this.rs485_term_enable = 1; // 0: off; 1: on

		this.serviceData = [];


		this._fifoSvcTasks = [];
		this._currSvcTask = null;

		this._timer = null;
		this._initSvcTable();
	}

	init() {
		this._spi = spi.openSync(0, 0);

		var promises = [];
		for (let i = 0; i < this.serviceData.length; i++) {
			promises.push(this._accessSvcRegister(i).promise);
		}
		process.nextTick(() => {
			this.run();
		});
		return Promise.all(promises);
	}

	_accessSvcRegister(index) {
		var cmd = new SvcCommand(index);
		this._fifoSvcTasks.push(cmd);
		return cmd;
	}

	close(done) {
		clearTimeout(this._timer);
		this._timer = null;
		this._spi.close(done);
	}

	run() {
		var txbuf = this._createTxBuffer();
		var rxbuf = new Buffer(txbuf.length);
		rxbuf.fill(0x00);

		var message = [{
			sendBuffer: txbuf, // Sent to read channel 5 
			receiveBuffer: rxbuf, // Raw data read from channel 5 
			byteLength: txbuf.length,
			speedHz: 400000 // Use a low bus speed to get a good reading from the TMP36 
		}];


		this._spi.transfer(message, (err, message) => {
			if (err) {
				this.emit('err', err);
			} else {
				var rxBuf = message[0].receiveBuffer;

				if (this._checkRxCrc(rxBuf)) {
					var rxdata = new RxData();
					rxdata.parse(rxBuf, this.ain1Mode, this.ain2Mode);

					if (this._currSvcTask) {
						var svc = this.serviceData[this._currSvcTask.index];
						if ((rxdata.svcRegister & 0x1FFF) === svc.register) {
							svc.value = rxdata.svcValue;

							// error bit
							if ((rxdata.svcRegister & 0x2000) !== 0) {
								this.emit('err', 'SVC ERR addr=' + svc.register + ' value=' + rxdata.svcValue);
								this._currSvcTask.reject();
							} else {
								this._currSvcTask.resolve();
							}
							this._currSvcTask = null;
						}
					}
					this.emit('rx', rxdata);
				} else {
					this.emit('err', 'Failed CRC Check on received message.', rxBuf);
				}
			}
			this._timer = setTimeout(() => {
				this.run();
			}, this._fifoSvcTasks.length > 0 ? 0 : this._period);
		});
	}

	_createTxBuffer() {
		var txbuf = new Buffer(24);
		txbuf.fill(0x00);

		// data service
		if (this._fifoSvcTasks.length > 0 && this._currSvcTask === null) {

			this.serviceData[0].register = (this.inService >> 16) & 0xFFFF;
			this.serviceData[0].value = this.inService & 0xFFFF;

			if ((this.rs485_baudrate / 100) !== this.serviceData[7].value) {
				this.serviceData[7].value = (this.rs485_baudrate / 100);
			}

			var rs485cfg = (3 << 3) /* 8 bits */ + (this.rs485_parity - 1) + ((this.rs485_stopbits_mode - 1) << 5);
			if (rs485cfg !== this.serviceData[8].value) {
				this.serviceData[8].value = rs485cfg;
			}

			var mnccfg = ((this.rs485_term_enable === 1) ? 1 : 0) + ((this.analogInputsInVoltageMode[0] === false) ? 2 : 0) + ((this.analogInputsInVoltageMode[1] === false) ? 4 : 0);
			if (mnccfg !== this.serviceData[9].value) {
				this.serviceData[9].value = mnccfg;
			}

			this._currSvcTask = this._fifoSvcTasks.pop();
			let index = this._currSvcTask.index;
			txbuf[0] = (this.serviceData[index].value >> 0) & 0xFF;
			txbuf[1] = (this.serviceData[index].value >> 8) & 0xFF;
			txbuf[2] = (this.serviceData[index].register >> 0) & 0xFF;
			txbuf[3] = (this.serviceData[index].register >> 8) & 0xFF;
		}

		// TODO control byte

		// LEDs		
		for (let i = 0; i < 8; i++) {
			if (this.LEDs[i].controlled) {
				txbuf[5] = txbuf[5] | (1 << i);
				if (this.LEDs[i].value) {
					txbuf[6] = txbuf[6] | (1 << i);
				}
			}
		}

		// digital outputs
		for (let i = 0; i < 4; i++) {
			if (this.digitalOutputs[i]) {
				txbuf[7] = txbuf[7] | (1 << i);
			}
		}

		// PWM
		var pwm1Div = pwmFreqToDiv(this.pwm1Freq);
		var pwm2Div = pwmFreqToDiv(this.pwm2Freq);

		var _pwm1a = Math.floor(65535 * this.pwm1a);
		var _pwm1b = Math.floor(65535 * this.pwm1b);
		var _pwm1c = Math.floor(65535 * this.pwm1c);
		var _pwm2a = Math.floor(65535 * this.pwm2a);

		txbuf[8] = (pwm1Div >> 0) & 0xFF;
		txbuf[9] = (pwm1Div >> 8) & 0xFF;

		txbuf[10] = (_pwm1a >> 0) & 0xFF;
		txbuf[11] = (_pwm1a >> 8) & 0xFF;

		txbuf[12] = (_pwm1b >> 0) & 0xFF;
		txbuf[13] = (_pwm1b >> 8) & 0xFF;

		txbuf[14] = (_pwm1c >> 0) & 0xFF;
		txbuf[15] = (_pwm1c >> 8) & 0xFF;

		txbuf[16] = (pwm2Div >> 0) & 0xFF;
		txbuf[17] = (pwm2Div >> 8) & 0xFF;

		txbuf[18] = (_pwm2a >> 0) & 0xFF;
		txbuf[19] = (_pwm2a >> 8) & 0xFF;

		// analog output		
		var ao1 = convertAnalogOutput(this.analogOutputs[0]);
		txbuf[20] = (ao1 >> 0) & 0xFF;
		txbuf[21] = (ao1 >> 8) & 0xFF;

		var ao2 = convertAnalogOutput(this.analogOutputs[1]);
		txbuf[22] = (ao2 >> 0) & 0xFF;
		txbuf[23] = (ao2 >> 8) & 0xFF;

		var crc = CRC.crc16modbus(txbuf);

		var crcBuf = new Buffer(2);
		crcBuf[0] = (crc >> 0) & 0xFF;
		crcBuf[1] = (crc >> 8) & 0xFF;

		txbuf = Buffer.concat([txbuf, crcBuf]);
		return txbuf;
	}

	setAnalogInputModeToVoltage(id) {
		if (id === 1) {
			this.analogInputsInVoltageMode[0] = true;
		} else if (id === 2) {
			this.analogInputsInVoltageMode[1] = true;
		}
	}

	setAnalogInputModeToCurrent(id) {
		if (id === 1) {
			this.analogInputsInVoltageMode[0] = false;
		} else if (id === 2) {
			this.analogInputsInVoltageMode[1] = false;
		}
	}

	_checkRxCrc(buf) {
		var msg = buf.slice(0, buf.length - 2);
		var crc = CRC.crc16modbus(msg);

		var crcBuf = new Buffer(2);
		crcBuf[0] = (crc >> 0) & 0xFF;
		crcBuf[1] = (crc >> 8) & 0xFF;

		if (crcBuf[0] === buf[buf.length - 2] && crcBuf[1] === buf[buf.length - 1]) {
			return true;
		}
		return false;
	}

	_initSvcTable() {
		var i = 0;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x00; // status word | user defined
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x01; // fw low ver
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x02; // fw high ver
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x03; // hw low ver
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x04; // hw high ver
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x05; // cpuid1
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x06; // cpuid2
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x07; // cpuid3
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x08; // cpuid4
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x14; // rx cnt - NOT IMPLEMENTED YET
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x15; // tx cnt - NOT IMPLEMENTED YET
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x18; // rx err frame
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x19; // rx err parity
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x100F; // watchdog timeout
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x1010; // rs485 bitrate
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x1011; // rs485 mode
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x100A; // monarco config 1
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x1024; // cnt1 mode
		this.serviceData[i].value = -1;
		i++;

		this.serviceData[i] = {};
		this.serviceData[i].register = 0x1025; // cnt2 mode
		this.serviceData[i].value = -1;
		i++;
	}
}

function convertAnalogOutput(dac) {
	var out;
	if (dac >= 10) {
		this.emit('warn', 'Analog output is set to invalid value. Valid values are 0..10 V.');
		out = 4095;
	} else if (dac < 0) {
		this.emit('warn', 'Analog output is set to invalid value. Valid values are 0..10 V.');
		out = 0;
	} else {
		out = Math.floor(((dac * 4095) / 10));
	}
	return out;
}

function pwmFreqToDiv(freq) {
	if (freq < 1) {
		return 0;
	} else if (freq < 10) {
		return 3 + ((32000000 / 512 / freq) & 0xFFFC);
	} else if (freq < 100) {
		return 2 + ((32000000 / 64 / freq) & 0xFFFC);
	} else if (freq < 1000) {
		return 1 + ((32000000 / 8 / freq) & 0xFFFC);
	} else if (freq < 100000) {
		return 0 + ((32000000 / 1 / freq) & 0xFFFC);
	} else {
		return 0;
	}
}

module.exports = new Monarco();