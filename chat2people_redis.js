var app = require('http').createServer(handler),
	io = require('socket.io').listen(app),
	fs = require('fs'),
	redis = require('redis');

app.listen(80);

function handler(req, res) {
	// just return the index HTML
	fs.readFile(__dirname + '/index.html',
	function (err, data) {
		if (err) {
			res.writeHead(500);
			return res.end('Error loading index.html');
		}

		res.writeHead(200);
		res.end(data);
	});
}

io.configure( function() {
	io.set('close timeout', 60*60*24); // time out trong vòng 24h
});

function SessionController (user,  chatChannel) {
	// class session controller dùng để chứa kết nối đến redis
	this.sub = redis.createClient(6379, "redis01.sdev.local");
	this.sub.auth('abc@123', function() {
		console.log('Redis client connected');
	});
	this.pub = redis.createClient(6379, "redis01.sdev.local");
	this.pub.auth('abc@123', function() {
		console.log('Redis client connected');
	});	  
	 
	this.chatChannel = chatChannel;

	this.user = user;
}

SessionController.prototype.subscribe = function(socket) {
	this.sub.on('message', function(channel, message) {
		socket.emit(channel, message);
	});
	var current = this;
	this.sub.on('subscribe', function(channel, count) {
		current.publish('{"action": "control", "user": "' + current.user + '", "msg": " tham gia phòng"}');
	});
	this.sub.subscribe(current.chatChannel);
};

SessionController.prototype.rejoin = function(socket, message) {
	this.sub.on('message', function(channel, message) {
		socket.emit(channel, message);
	});
	var current = this;
	this.sub.on('subscribe', function(channel, count) {
		current.publish('{"action": "control", "user": "' + current.user + '", "msg": "quay lại phòng chat"}');
		current.publish('{"action": "message", "user": "' + message.user + '", "msg":"' + this.htmlEntitiesEncode(message.msg) +'"}');
	});
	this.sub.subscribe(current.chatChannel);
};

SessionController.prototype.unsubscribe = function() {
	var current = this;
	this.sub.unsubscribe(current.chatChannel);
};

SessionController.prototype.publish = function(message) {
	var current = this;
	this.pub.publish(current.chatChannel, message);
};

SessionController.prototype.destroyRedis = function() {
	if (this.sub !== null) this.sub.quit();
	if (this.pub !== null) this.pub.quit();
};

SessionController.prototype.htmlEntitiesEncode = function(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

io.sockets.on('connection', function (socket) {
	console.log(socket.id);
	socket.on('chat', function (data) { // nhận chat message
		socket.get('sessionController', function(err, sessionController) {
			var newSessionController = new SessionController(data.user);
			if (sessionController === null) {
				// Socket có thể bị time out hoặc mất kết nối
				socket.set('sessionController', newSessionController);
				newSessionController.rejoin(socket, data);
			} else {
				sessionController.publish('{"action": "message", "user": "'+ data.user +'", "msg": "'+ newSessionController.htmlEntitiesEncode(data.msg) +'"}');
			}
		});
		// kiểm tra dữ liệu chat
		console.log(data);
	});

	socket.on('join', function(data) {
		var sessionController = new SessionController(data.user, data.chatChannel);
		socket.set('sessionController', sessionController);
		sessionController.subscribe(socket);
	});

	socket.on('disconnect', function() { // Một socket bị mất kết nối - thường xảy ra khi mạng của người dùng có vấn đề
		socket.get('sessionController', function(err, sessionController) {
			if (sessionController === null) return;
			sessionController.unsubscribe();
			sessionController.publish('{"action": "control", "user": "' + sessionController.user +'", "msg": "thoát phòng chat"}');
			sessionController.destroyRedis();
		});
	});
});