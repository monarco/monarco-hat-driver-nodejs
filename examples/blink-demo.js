'use strict';

var SDC_FIXED_RS485BAUD = 0x1010;
var SDC_FIXED_RS485MODE = 0X1011;
var SDC_FIXED_CNT1MODE = 0x1024;
var SDC_FIXED_CNT2MODE = 0x1025;

var monarco = require('../src/monarco.js');

console.log('### Monarco HAT Node.js library \'blink demo\' example v1.0');

monarco._period = 20;
console.log('\nCycle interval: ' + monarco._period + ' [ms]\n');

setRegValue(monarco.serviceData, SDC_FIXED_CNT1MODE, monarco.SDC.MONARCO_SDC_COUNTER_MODE_OFF);
setRegValue(monarco.serviceData, SDC_FIXED_CNT2MODE, monarco.SDC.MONARCO_SDC_COUNTER_MODE_OFF);
setRegValue(monarco.serviceData, SDC_FIXED_RS485BAUD, 384);
setRegValue(monarco.serviceData, SDC_FIXED_RS485MODE, monarco.SDC.MONARCO_SDC_RS485_DEFAULT_MODE);

// set up LED1 & LED2 to be controlled manualy
monarco.LEDs[0].controlled = true;
monarco.LEDs[0].value = false;
monarco.LEDs[1].controlled = true;
monarco.LEDs[1].value = false;

monarco.on('err', (err, msg) => {
	console.log('ERROR: ' + err);
	if(msg){
		console.log('Message: ' + msg.toString('hex'));
	}
});

monarco.init().then(() => {

	var tick = 0;

	monarco.on('rx', (rxdata) => {
		tick++;

        // Each 10 ticks (0.2 s) - toggle LED1 / LED2
        if(tick % 10 == 0){
            if((tick % 20) == 0){
    		    monarco.LEDs[0].value = true;
           	    monarco.LEDs[1].value = false;
            } else {
                monarco.LEDs[0].value = false;
           	    monarco.LEDs[1].value = true;
            }
        }

        //  Each 50 ticks (1 s) - toggle DOUT1
        if ((tick % 50) == 0) {
            if (monarco.digitalOutputs[0]) {
                monarco.digitalOutputs[0] = false;
            }
            else {
                monarco.digitalOutputs[0] = true;
            }
        }


		// console output		
		if(tick % 25 == 0){
		    var buf = '';

		    for(var i = 0; i < rxdata.digitalInputs.length; i++){		
           	    buf += 'DI' + (i + 1) + ': ';		
	    		buf += rxdata.digitalInputs[i] ? 1:0;
          		buf += ' ';
		    }
		    buf += '| ';
		    buf += 'AIN1: ';
		    buf += rxdata.ai1.toFixed(3);
		    buf += ' | ';
		    buf += 'AIN2: ';
       	    buf += rxdata.ai2.toFixed(3);

		    console.log(buf);
		}
	});
});

function setRegValue(registers, id, value){
    for(var itm of registers){
	if(itm.register === id){
	    return itm.value = value;
	}
    }
    console.log('Register not found: ' + id);
}
