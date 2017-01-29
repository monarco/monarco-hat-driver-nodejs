'use strict';
/*jshint bitwise: false*/

class RxData {
	constructor() {
		this.digitalInputs = [false, false, false, false];
		this.analogInputs = [0, 0];
		this.spiStatus = 0;
		this.cnt1 = 0;
		this.cnt2 = 0;
		this._buffer = null;

		this.svcValue = -1;
    		this.svcRegister = -1;
	}

	parse(buf, ain1Mode, ain2Mode) {

		this.svcValue = ((buf[0] << 0) | (buf[1] << 8));
        	this.svcRegister = ((buf[2] << 0) | (buf[3] << 8));

		// spi status byte
		this.spiStatus = buf[4];

		// digital inputs
		var digInputs = buf[7];
		for (let i = 0; i < 4; i++) {
			this.digitalInputs[i] = ((digInputs & (1 << i)) !== 0);
		}

		// Counter1
		this.cnt1 = (buf[8] | (buf[9] << 8) | (buf[10] << 16) | (buf[11] << 24));
		// Counter2
		this.cnt2 = (buf[12] | (buf[13] << 8) | (buf[14] << 16) | (buf[15] << 24));


		// analog inputs
		this.ai1 = (buf[20] | (buf[21] << 8)) * ((ain1Mode === 2) ? 50.0 : 10.0) / 4095.0;
  		this.ai2 = (buf[22] | (buf[23] << 8)) * ((ain2Mode === 2) ? 50.0 : 10.0) / 4095.0;

		this._buffer = buf;
	}
}

module.exports = RxData;