'use strict';

class SvcCommand {
	constructor(index) {		
		this.index = index;
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;		
		});		
	}
}

module.exports = SvcCommand;