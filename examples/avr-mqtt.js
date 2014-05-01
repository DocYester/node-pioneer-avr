var avr    = require("../pioneer-avr"),
	mqtt   = require('mqtt'),
   	crypto = require('crypto');

var TRACE = true;


var defaultOptions = {
    log: true,
    vsx: {
	    host: "192.168.0.9",
    	port: 23,
    },
    mqtt : {
    	"host" : "192.168.0.23",
    	"port" : 1883
    },
};

var AvrMqtt = function(options) {
	var self = this;
	
	options = options || defaultOptions;
	
    var rootTopic = options.vsx.uuid ? "/meem/" + options.vsx.uuid + "/" : "/house/lounge/avr/";
	
    options.mqttPaths = options.mqttPaths || {
    	powerIn    : rootTopic + "power/in",
    	powerOut   : rootTopic + "power/out",
    	volumeIn   : rootTopic + "volume/in",
    	volumeOut  : rootTopic + "volume/out",
    	muteIn     : rootTopic + "mute/in",
    	muteOut    : rootTopic + "mute/out",
    	sourceIn   : rootTopic + "source/in",
    	sourceOut  : rootTopic + "source/out",
    	sourcesOut : rootTopic + "sources/out",		// to send the available input sources
    }

	this.TOPIC_powerIn   = options.mqttPaths.powerIn    || "/house/av/avr/power/in";	// power control
	this.TOPIC_powerOut  = options.mqttPaths.powerOut   || "/house/av/avr/power/out";	// power state
	this.TOPIC_volumeIn  = options.mqttPaths.volumeIn   || "/house/av/avr/volume/in";	// volume control
	this.TOPIC_volumeOut = options.mqttPaths.volumeOut  || "/house/av/avr/volume/out";	// volume state
	this.TOPIC_muteIn    = options.mqttPaths.muteIn     || "/house/av/avr/mute/in";
	this.TOPIC_muteOut   = options.mqttPaths.muteOut    || "/house/av/avr/mute/out";
	this.TOPIC_sourceIn  = options.mqttPaths.sourceIn   || "/house/av/avr/source/in";
	this.TOPIC_sourceOut = options.mqttPaths.sourceOut  || "/house/av/avr/source/out";
	this.TOPIC_sourcesOut = options.mqttPaths.sourcesOut || "/house/av/avr/sources/out";

	this.state = { power : {}, volume : {}, mute : {}, source : {}, sources : {} };

	this.receiver = new avr.VSX(options.vsx);
	this.receiver.on("connect", function() {
		self._handleAvrConnect(options.mqtt);
	});
	
	this.mqttClient = null;
};

AvrMqtt.prototype.subscribe = function() {
	if (this.mqttClient) {
		// sobscribe to contorl topics
		this.mqttClient.subscribe(this.TOPIC_powerIn);
		this.mqttClient.subscribe(this.TOPIC_volumeIn);
		this.mqttClient.subscribe(this.TOPIC_muteIn);
		this.mqttClient.subscribe(this.TOPIC_sourceIn);
		
		// subscribe to topics for requests for initial-content (state).
		this.mqttClient.subscribe(this.TOPIC_powerOut+"?");
		this.mqttClient.subscribe(this.TOPIC_volumeOut+"?");
		this.mqttClient.subscribe(this.TOPIC_muteOut+"?");
		this.mqttClient.subscribe(this.TOPIC_sourceOut+"?");
		this.mqttClient.subscribe(this.TOPIC_sourcesOut+"?");
	}
};

AvrMqtt.prototype._handleAvrConnect = function(options) {
	var self = this;
	if (TRACE) {
		console.log("AV Receiver connected");
	}
	
	// connect to MQTT service
	var clientId = crypto.randomBytes(24).toString("hex");
		
	self.mqttClient = mqtt.createClient(options.port, options.host, {
		keepalive: 300,
		client : clientId
	});

	// add handlers to MQTT client
	self.mqttClient.on('connect', function() {
		if (TRACE) {
			console.log('MQTT sessionOpened');
		}
		self.subscribe();	// subscribe to control and request topics
	});
	self.mqttClient.on('close', function() {
		if (TRACE) {
			console.log('MQTT close');
		}
	});
	self.mqttClient.on('error', function(e) {
		if (TRACE) {
			console.log('MQTT error: ' + e);
		}
	});
	self.mqttClient.addListener('message', function(topic, payload) {
		// got data from subscribed topic
		if (TRACE) {
			console.log('received ' + topic + ' : ' + payload);
		}

		// check if message is a request for current value, send response
		var i = topic.indexOf("?");
		if (i > 0) {
			self._handleContentRequest(topic, payload);
		}
		else {
			self._handleInput(topic, payload);
		}
	});

	// add AVR state handlers	
	self.receiver.on('power', function(power) {
		self.state.power = { value : power };
		self.mqttClient.publish(
			self.TOPIC_powerOut, 
			JSON.stringify(self.state.power)
		);
	});
	self.receiver.on('volume', function(db) {
		self.state.volume = { value : db, unit : "dB" };
		self.mqttClient.publish(
			self.TOPIC_volumeOut,
			JSON.stringify(self.state.volume)
		);
	});
	self.receiver.on('mute', function(mute) {
		self.state.mute = { value : mute };
		self.mqttClient.publish(
			self.TOPIC_muteOut, 
			JSON.stringify(self.state.mute)
		);
	});
	self.receiver.on('input', function(source, name) {
		self.state.source = { value : source, name: name };
		self.mqttClient.publish(
			self.TOPIC_sourceOut, 
			JSON.stringify(self.state.source)
		);
	});
	self.receiver.on('inputName', function(id, name) {
		// update and send available sources
		if (TRACE) {
			console.log("VSX got source: " + id + " : " + name);
		}
		self.state.sources[id] = name;
		self.mqttClient.publish(
				self.TOPIC_sourcesOut, 
				JSON.stringify(self.state.sources)
			);

		// if the name is for the current selected source, then send input source state
		if (self.state.source && self.state.source.value == id) {
			self.state.source = { value : id, name: name };
			self.mqttClient.publish(
				self.TOPIC_sourceOut, 
				JSON.stringify(self.state.source)
			);
		}
	});
};


AvrMqtt.prototype._handleContentRequest = function(topic, payload) {
	var self = this;
	var i = topic.indexOf("?");
	var requestTopic = topic.slice(0, i);
	var responseTopic = payload;
	if (TRACE) {
		console.log("requestTopic: " + requestTopic + "  responseTopic: " + responseTopic);
	}
	if (requestTopic == self.TOPIC_powerOut) {
		if (TRACE) {
			console.log("sending powerOut content: " + self.state.power);
		}
		self.mqttClient.publish(responseTopic, JSON.stringify(self.state.power));
	}
	else if (requestTopic == self.TOPIC_volumeOut) {
		if (TRACE) {
			console.log("sending volumeOut content: " + self.state.volume);
		}
		self.mqttClient.publish(responseTopic, JSON.stringify(self.state.volume));
	}
	else if (requestTopic == self.TOPIC_muteOut) {
		if (TRACE) {
			console.log("sending muteOut content: " + self.state.mute);
		}
		self.mqttClient.publish(responseTopic, JSON.stringify(self.state.mute));
	}
	else if (requestTopic == self.TOPIC_sourceOut) {
		if (TRACE) {
			console.log("sending sourceOut content: " + self.state.source);
		}
		self.mqttClient.publish(responseTopic, JSON.stringify(self.state.source));
	}
	else if (requestTopic == self.TOPIC_sourcesOut) {
		if (TRACE) {
			console.log("sending sourcesOut content: " + self.state.sources);
		}
		self.mqttClient.publish(responseTopic, JSON.stringify(self.state.sources));
	}
};

/**
 * Handle an input MQTT message
 * @param {Object} self
 * @param {Object} packet
 */
AvrMqtt.prototype._handleInput = function(topic, payload) {
	var self = this;
	
	if (topic == self.TOPIC_powerIn) {
		var msg = JSON.parse(payload);
		self.receiver.power(msg.value);
	}
	else if (topic == self.TOPIC_volumeIn) {
		var msg = JSON.parse(payload);
		self.receiver.volume(msg.value);
	}
	else if (topic == self.TOPIC_muteIn) {
		var msg = JSON.parse(payload);
		self.receiver.mute(msg.value);
	}
	else if (topic == self.TOPIC_sourceIn) {
		var msg = JSON.parse(payload);
		self.receiver.selectInput(msg.value);
	}
	// else unhandled topic
};

exports.AvrMqtt = AvrMqtt;
exports.Inputs = avr.Inputs;