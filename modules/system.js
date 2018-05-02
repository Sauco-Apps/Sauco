'use strict';

var async = require('async');
var crypto = require('crypto');
var os = require('os');
var sandboxHelper = require('../helpers/sandbox.js');
var constants = require('../helpers/constants.js');
var semver = require('semver');
var sql = require('../sql/system.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

var rcRegExp = /[a-z]+$/;

/**
 * Initializes library with scope content and private variables:
 * - os
 * - version
 * - port
 * - height
 * - nethash
 * - broadhash
 * - minVersion
 * - nonce
 * @class
 * @classdesc Main System methods.
 * @implements {os}
 * @param {setImmediateCallback} cb - Callback function.
 * @param {scope} scope - App instance.
 */
// Constructor
function System (cb, scope) {
	library = {
		logger: scope.logger,
		db: scope.db,
		nonce: scope.nonce,
		config: {
			port: scope.config.port,
			nethash: scope.config.nethash,
		},
	};
	self = this;

	__private.os = os.platform() + os.release();
	__private.version = constants.currentVersion;
	__private.port = library.config.port;
	__private.height = 1;
	__private.nethash = library.config.nethash;
	__private.broadhash = library.config.nethash;
	__private.nonce = library.nonce;

	setImmediate(cb, null, self);
}

// Public methods
/**
 * Returns private variables object content.
 * @return {Object}
 */
System.prototype.headers = function () {
	return __private;
};

/**
 * Gets private variable `os`
 * @return {string}
 */
System.prototype.getOS = function () {
	return __private.os;
};

/**
 * Gets private variable `version`
 * @return {string}
 */
System.prototype.getVersion = function () {
	return __private.version;
};

/**
 * Gets private variable `port`
 * @return {number}
 */
System.prototype.getPort = function () {
	return __private.port;
};

/**
 * Gets private variable `height`
 * @return {number}
 */
System.prototype.getHeight = function () {
	return __private.height;
};

/**
 * Gets private variable `nethash`
 * @return {hash}
 */
System.prototype.getNethash = function () {
	return __private.nethash;
};

/**
 * Gets `teamAccount` based on nethash
 * @return {publicKey}
 */
System.prototype.getTeamAccount = function () {
	var idx = constants.nethashes.indexOf(__private.nethash);
	return constants.teamAccounts[idx];
};

/**
 * Gets private variable `nonce`
 * @return {nonce}
 */
System.prototype.getNonce = function () {
	return __private.nonce;
};
/**
 * Gets private variable `nethash` and compares with input param.
 * @param {hash}
 * @return {boolean} True if input param is equal to private value.
 */
System.prototype.networkCompatible = function (nethash) {
	return __private.nethash === nethash;
};

/**
 * Gets private variable `minVersion`
 * @return {string}
 */
System.prototype.getMinVersion = function (height) {
	height = height || modules.blocks.lastBlock.get().height;

	var minVer = '';
	for ( var i = constants.minVersion.length - 1; i >= 0 && minVer == ''; --i ) {
		if (height>=constants.minVersion[i].height)
			{minVer = constants.minVersion[i].ver;}
	}

	// update this.minVersion / this.minVersionChar, if necessary
	if (minVer != this.lastMinVer) {
		this.lastMinVer = minVer;
		if (rcRegExp.test(minVer)) {
			this.minVersion = minVer.replace(rcRegExp, '');
			this.minVersionChar = minVer.charAt(minVer.length - 1);
		} else {
			this.minVersion = minVer;
			this.minVersionChar = '';
		}
	}

	return minVer;
};

/**
 * Checks version compatibility from input param against private values.
 * @implements {semver}
 * @param {string} version
 * @return {boolean}
 */
System.prototype.versionCompatible = function (version) {
	this.getMinVersion();		// set current minVersion

	var versionChar;

	if (rcRegExp.test(version)) {
		versionChar = version.charAt(version.length - 1);
		version = version.replace(rcRegExp, '');
	}

	// if no range specifier is used for minVersion, check the complete version string (inclusive versionChar)
	var rangeRegExp = /[\^~\*]/;
	if (this.minVersionChar && versionChar && !rangeRegExp.test(this.minVersion)) {
		return (version + versionChar) === (this.minVersion + this.minVersionChar);
	}

	// ignore versionChar, check only version
	return semver.satisfies(version, this.minVersion);
};

/**
 * Gets private nethash or creates a new one, based on input param and data.
 * @implements {library.db.query}
 * @implements {crypto.createHash}
 * @param {*} cb
 * @return {hash|setImmediateCallback} err | private nethash or new hash.
 */
System.prototype.getBroadhash = function (cb) {
	if (typeof cb !== 'function') {
		return __private.broadhash;
	}

	library.db.query(sql.getBroadhash, { limit: 5 }).then(function (rows) {
		if (rows.length <= 1) {
			return setImmediate(cb, null, __private.nethash);
		} else {
			var seed = rows.map(function (row) { return row.id; }).join('');
			var hash = crypto.createHash('sha256').update(seed, 'utf8').digest();

			return setImmediate(cb, null, hash.toString('hex'));
		}
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, err);
	});
};

System.prototype.getFees = function (height) {
	height = height || modules.blocks.lastBlock.get().height+1;

	var i;
	for (i=constants.fees.length-1; i>0; i--)	{
		if (height>=constants.fees[i].height) {
			break;
		}
	}

	return {
		fromHeight: constants.fees[i].height,
		toHeight: i == constants.fees.length-1 ? null : constants.fees[i+1].height-1,
		height: height,
		fees: constants.fees[i].fees
	};
};

/**
 * Updates private broadhash and height values.
 * @implements {async.series}
 * @implements {System.getBroadhash}
 * @implements {modules.blocks.lastBlock.get}
 * @implements {modules.transport.headers}
 * @param {function} cb Callback function
 * @return {setImmediateCallback} cb, err
 */
System.prototype.update = function (cb) {
	async.series({
		getBroadhash: function (seriesCb) {
			self.getBroadhash(function (err, hash) {
				if (!err) {
					__private.broadhash = hash;
				}

				return setImmediate(seriesCb);
			});
		},
		getHeight: function (seriesCb) {
			__private.height = modules.blocks.lastBlock.get().height;
			return setImmediate(seriesCb);
		}
	}, function (err) {
		library.logger.debug('System headers', __private);
		modules.transport.headers(__private);
		return setImmediate(cb, err);
	});
};

/**
 * Calls helpers.sandbox.callMethod().
 * @implements module:helpers#callMethod
 * @param {function} call - Method to call.
 * @param {*} args - List of arguments.
 * @param {function} cb - Callback function.
 */
System.prototype.sandboxApi = function (call, args, cb) {
	sandboxHelper.callMethod(shared, call, args, cb);
};

// Events
/**
 * Assigns used modules to modules variable.
 * @param {modules} scope - Loaded modules.
 */
System.prototype.onBind = function (scope) {
	modules = {
		blocks: scope.blocks,
		transport: scope.transport,
	};
};

// Export
module.exports = System;
