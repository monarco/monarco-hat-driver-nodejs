'use strict';

var SDC_FIXED_FWVERL = 1;
var SDC_FIXED_FWVERH = 2;
var SDC_FIXED_HWVERL = 3;
var SDC_FIXED_HWVERH = 4;
var SDC_FIXED_CPUID1 = 5;
var SDC_FIXED_CPUID2 = 6;
var SDC_FIXED_CPUID3 = 7;
var SDC_FIXED_CPUID4 = 8;
var SDC_FIXED_RS485BAUD = 0x1010;
var SDC_FIXED_RS485MODE = 0X1011;
var SDC_FIXED_WATCHDOG = 0X100F;
var SDC_FIXED_CNT1MODE = 0x1024;
var SDC_FIXED_CNT2MODE = 0x1025;

var monarco = require('../src/monarco.js');

console.log('### Monarco HAT Node.js library \'complex demo\' example v1.0');

console.log('\nCycle interval: ' + monarco._period + ' [ms]\n');


for(var i = 0; i < monarco.LEDs.length; i++){
    monarco.LEDs[i].controlled = true;
    monarco.LEDs[i].value = false;
}

setRegValue(monarco.serviceData, SDC_FIXED_CNT1MODE, monarco.SDC.MONARCO_SDC_COUNTER_MODE_OFF);
setRegValue(monarco.serviceData, SDC_FIXED_CNT2MODE, monarco.SDC.MONARCO_SDC_COUNTER_MODE_QUAD);
setRegValue(monarco.serviceData, SDC_FIXED_RS485BAUD, 384);
setRegValue(monarco.serviceData, SDC_FIXED_RS485MODE, monarco.SDC.MONARCO_SDC_RS485_DEFAULT_MODE);
setRegValue(monarco.serviceData, SDC_FIXED_WATCHDOG, 1000);


monarco.on('err', (err, msg) => {
	console.log('ERROR: ' + err);
	if(msg){
		console.log('Message: ' + msg.toString('hex'));
	}
});

monarco.init().then(() => {

	var FW = (getRegValue(monarco.serviceData, SDC_FIXED_FWVERH) << 16)
		+ (getRegValue(monarco.serviceData, SDC_FIXED_FWVERL));

	var HW = (getRegValue(monarco.serviceData, SDC_FIXED_HWVERH) << 16)
		+ (getRegValue(monarco.serviceData, SDC_FIXED_HWVERL));

	var CPUID_1 = (getRegValue(monarco.serviceData, SDC_FIXED_CPUID4) << 16)
		+ (getRegValue(monarco.serviceData, SDC_FIXED_CPUID3));

	var CPUID_2 = (getRegValue(monarco.serviceData, SDC_FIXED_CPUID2) << 16)
		+ (getRegValue(monarco.serviceData, SDC_FIXED_CPUID1));


	console.log('MONARCO SDC INIT DONE, FW=' + pad(FW.toString(16), 8) + ', HW=' + pad(HW.toString(16), 8) + ', CPUID=' + pad(CPUID_1, 8) + pad(CPUID_2, 8));


	var tick = 0;

	monarco.on('rx', (rxdata) => {
		tick++;

		// console output		
		if(tick % 32 == 0){
		    var buf = '';
	    		
		    buf += 'DI1..4: ';		
		    for(var i = 0; i < rxdata.digitalInputs.length; i++){		
	    		buf += rxdata.digitalInputs[i] ? 1:0;
		    }
		    buf += ' | ';

		    buf += 'CNT1: ';
		    buf +=  pad(rxdata.cnt1, 5);
		    buf += ' | ';
		    buf += 'CNT2: ';				    
		    buf +=  pad(rxdata.cnt2, 5);
		    buf += ' | ';
		    buf += 'AIN1: ';
		    buf += rxdata.ai1.toFixed(3);
		    buf += ' | ';
		    buf += 'AIN2: ';
	    	    buf += rxdata.ai2.toFixed(3);

		    console.log(buf);
		}
		
		// LED1-LED8 - loop		
		for(var i = 0; i < monarco.LEDs.length; i++){
		    monarco.LEDs[i].controlled = true;
		    monarco.LEDs[i].value = false;		
		}
		monarco.LEDs[tick % monarco.LEDs.length].value = true;		

		// AOUT1 = 2.0V
		monarco.analogOutputs[0] = 2.0;

		// AOUT2 = 5.0V + superimposed sinus with amplitude 4.0V
		monarco.analogOutputs[1] = 5.0 + 4.0 * Math.sin((tick % 2048) / 2048.0 * 2 * 3.141592);

		// DOUT3, DOUT4 -- quadrature encoder emulation
		if(tick % 32 == 0){
		    if(monarco.digitalOutputs[2] && monarco.digitalOutputs[3]){
			monarco.digitalOutputs[3] = false;
		    }else if(monarco.digitalOutputs[2]){
			monarco.digitalOutputs[2] = false;
		    }else if(monarco.digitalOutputs[3]){
			monarco.digitalOutputs[2] = true;
		    }else{
			monarco.digitalOutputs[3] = true;
		    }
		}
	});
});


function pad(num, size){
    var s = "0000000000" + num;
    return s.substr(s.length-size);
}

function getRegValue(registers, id){
    for(var itm of registers){
	if(itm.register === id){
	    return itm.value;
	}    
    }
    console.log('Register not found: ' + id);
    return 0;
}

function setRegValue(registers, id, value){
    for(var itm of registers){
	if(itm.register === id){
	    return itm.value = value;
	}
    }
    console.log('Register not found: ' + id);
}
