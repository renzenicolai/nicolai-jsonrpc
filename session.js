/**
 * Copyright 2022 Renze Nicolai
 * SPDX-License-Identifier: MIT
 */

"use strict";

const crypto = require("crypto");

class Session {
    constructor(aPermissions = [], aRpcMethodPrefix = "") {
        // The unique identifier for this session
        this._id = crypto.randomBytes(64).toString("base64");
        
        // Unix timestamps for keeping track of the amount of seconds this session has been idle
        this._dateCreated = Math.floor(Date.now() / 1000);
        this._dateLastUsed = this._dateCreated;
        
        // Prefix for RPC methods of the SessionManager
        this._parentRpcMethodPrefix = aRpcMethodPrefix;
        
        // List of methods which this session may call (may be extended by the associated user account)
        this._permissions = aPermissions;
        
        // User account associated with this session
        this._user = null;
        
        // Push message subscriptions
        this._subscriptions = {};

        // Connections
        this._connections = [];
    }
    
    getIdentifier() {
        // Returns the unique identifier of this session
        return this._id;
    }
    
    getCreatedAt() {
        // Returns a unix timestamp representing the moment this session was created
        return this._dateCreated;
    }
    
    getUsedAt() {
        // Returns a unix timestamp representing the moment this session was last used
        return this._dateLastUsed;
    }
    
    use() {
        // Update the timestamp representing the moment this session was last used to the current time
        this._dateLastUsed = Math.floor(Date.now() / 1000);
    }
    
    setUser(user) {
        // Set the associated user account, to remove the associated account the user must be set to null
        this._user = user;
    }
    
    getUser() {
        // Get the associated user account
        if (this._user === null) return null;
        if (typeof this._user.summarize === "function") return this._user.summarize();
        if (typeof this._user.serialize === "function") return this._user.serialize();
        return this._user;
    }
    
    getPermissions() {
        // Get the full list of methods this session is permitted to call
        let userPermissions = this._user ? ((typeof this._user.getPermissions === "function") ? this._user.getPermissions() : []) : [];
        return this._permissions.concat(userPermissions);
    }

    checkPermission(methodName) {
        // Check weither or not a specific method may be called by this session
        for (let index = 0; index < this._permissions.length; index++) {
            if (this._permissions[index] === methodName) {
                return true;
            }
        }
        if ((this._user !== null) && (typeof this._user.checkPermission === "function")) {
            return this._user.checkPermission(methodName);
        }
        return false;
    }
    
    addPermission(methodName) {
        // Add a method name to the permissions list
        let result = false;
        if (!this._permissions.includes(methodName)) {
            this._permissions.push(methodName);
            result = true;
        }
        return result;
    }
    
    removePermission(methodName) {
        // Remove a method name from the permissions list
        let result = false;
        if (this._permissions.includes(methodName)) {
            this._permissions = this._permissions.filter(item => item !== methodName);
            result = true;
        }
        return result;
    }

    getSubscriptions(identifier = "anonymous") {
        // Get the list of subscriptions for a specific connection identifier
        if (identifier in this._subscriptions) {
            return this._subscriptions[identifier];
        }
        throw new Error("Unknown connection");
    }
    
    subscribe(subject, identifier = "anonymous") {
        // Subscribe to a pushmessage topic
        if (!this.checkPermission(subject)) {
            throw new Error("Access denied");
        }
        if (identifier in this._subscriptions) {
            if (!this._subscriptions[identifier].includes(subject)) {
                this._subscriptions[identifier].push(subject);
                return true;
            }
            return false;
        }
        throw new Error("Unknown connection");
    }

    unsubscribe(subject, identifier = "anonymous") {
        // Unsubscribe from a pushmessage topic
        if (identifier in this._subscriptions) {
            if (this._subscriptions[identifier].includes(subject)) {
                this._subscriptions[identifier] = this._subscriptions[identifier].filter(item => item !== subject);
                return true;
            }
            return false;
        }
        throw new Error("Unknown connection");
    }
    
    serialize() {
        return {
            id: this._id,
            user: this.getUser(),
            dateCreated: this._dateCreated,
            dateLastUsed: this._dateLastUsed,
            subscriptions: this._subscriptions,
            permissions: this._permissions
        };
    }
    
    summarize() {
        return {
            user: this.getUser(),
            dateCreated: this._dateCreated,
            subscriptions: this._subscriptions,
            permissions: this._permissions
        };
    }

    setConnection(connection) {
        // Check if the parameter is an object
        if ((typeof connection !== "object") || (connection === null)) {
            return;
        }

        // If the connection object does not have an identifier yet add an identifier
        if (typeof connection.smIdentifier !== "string") {
            // Generate an identifier
            connection.smIdentifier = crypto.randomBytes(64).toString("base64");
        }
        
        // Add the connection to the connections list if needed
        if (!(connection.smIdentifier in this._connections)) {
            // Store the connection object in the list of connections
            this._connections[connection.smIdentifier] = connection;
            // Add cleanup hook to the connection
            connection.on("close", this._onConnectionClose.bind(this, connection));
        }

        // Add the connection identifier to the subscriptions list if needed
        if (!(connection.smIdentifier in this._subscriptions)) {
            this._subscriptions[connection.smIdentifier] = [];
        }
    }

    _onConnectionClose(connection) {
        if (connection.smIdentifier in this._connections) {
            delete this._connections[connection.smIdentifier];
        }
        if (connection.smIdentifier in this._subscriptions) {
            delete this._subscriptions[connection.smIdentifier];
        }
    }
    
    async push(subject, message, identifier) {
        let result = false;
        for (let identifier in this._subscriptions) {
            if (this._subscriptions[identifier].includes(subject)) {
                await this._connections[identifier].send(JSON.stringify({
                    pushMessage: true,
                    subject: subject,
                    message: message
                }));
                result = true;
            }
        }
        return result;
    }
}

class SessionManager {
    constructor(opts={}) {
        this._opts = Object.assign({
            timeout: null,
            userSchema: {}
        }, opts);

        this.sessions = [];
        this.alwaysAllow = [];
        
        if (this._opts.timeout !== null) {
            setTimeout(this._gc.bind(this), 5000);
        }

        this._rpcMethodPrefix = "";

        this._publicMethods = [];

        this.userSchema = this._opts.userSchema;
    }
    
    /* Internal functions */
    
    _destroySession(id) {
        for (var i in this.sessions) {
            if (this.sessions[i].getIdentifier() === id) {
                this.sessions.splice(i,1);
                return true;
            }
        }
        return false;
    }
    
    _gc() {
        if (this._opts.timeout === null) {
            return;
        }
        
        var now = Math.floor((new Date()).getTime() / 1000);
        
        var sessionsToKeep = [];
        for (var i in this.sessions) {
            var unusedSince = now-this.sessions[i].getUsedAt();
            if (unusedSince < this._opts.timeout) {
                sessionsToKeep.push(this.sessions[i]);
            }
        }
        
        this.sessions = sessionsToKeep;
        
        // Reschedule the garbage collector
        setTimeout(this._gc.bind(this), 5000);
    }
    
    /* System functions */

    push(subject, message) { // Broadcast to all sessions
        for (let index in this.sessions) {
            this.sessions[index].push(subject, message);
        }
    }
    
    getSession(token) {
        for (let index in this.sessions) {
            if (this.sessions[index].getIdentifier()===token) {
                return this.sessions[index];
            }
        }
        return null;
    }

    getSessions() {
        return this.sessions;
    }

    setPublicMethods(methods) {
        this._publicMethods = methods;
    }
    
    setUserSchema(schema) {
        this.userSchema = schema;
    }

    /* RPC API functions: management of individual sessions */

    // eslint-disable-next-line no-unused-vars
    async createSession(parameters, session) {
        let newSession = new Session(this._publicMethods, this._rpcMethodPrefix); // The JSON operations here copy the permissions array
        this.sessions.push(newSession);
        return newSession.getIdentifier();
    }

    async destroyCurrentSession(parameters, session) {
        let result = false;
        for (var i in this.sessions) {
            if (this.sessions[i] === session) {
                this.sessions.splice(i,1);
                result = true;
                break;
            }
        }
        return result;
    }
    
    async state(parameters, session) {
        if (session === null) {
            throw new Error("No session");
        }
        return session.summarize();
    }
    
    async listPermissionsForCurrentSession(parameters, session) {
        if (session === null) {
            throw new Error("No session");
        }
        return session.getPermissions();
    }
    
    async getSubscriptions(parameters, session, connection) {
        if (session === null) {
            throw new Error("No session");
        }
        if (connection === null) {
            throw new Error("No persistent connection");
        }
        if (typeof connection.smIdentifier !== "string") {
            throw new Error("Connection doesn't have an identifier");
        }
        return session.getSubscriptions(connection.smIdentifier);
    }
    
    async subscribe(parameters, session, connection) {
        if (session === null) {
            throw new Error("No session");
        }
        if (connection === null) {
            throw new Error("No persistent connection");
        }
        if (typeof connection.smIdentifier !== "string") {
            throw new Error("Connection doesn't have an identifier");
        }
        if (typeof parameters === "string") {
            return session.subscribe(parameters, connection.smIdentifier);
        } else {
            let result = [];
            for (let i = 0; i < parameters.length; i++) {
                if (!session.checkPermission(parameters[i], true)) {
                    throw new Error("Access denied");
                }
            }
            for (let i = 0; i < parameters.length; i++) {
                result.push(session.subscribe(parameters[i], connection.smIdentifier));
            }
            return result;
        }
    }

    async unsubscribe(parameters, session, connection) {
        if (session === null) {
            throw new Error("No session");
        }
        if (connection === null) {
            throw new Error("No persistent connection");
        }
        if (typeof connection.smIdentifier !== "string") {
            throw new Error("Connection doesn't have an identifier");
        }
        if (typeof parameters === "string") {
            let result = await session.unsubscribe(parameters, connection.smIdentifier);
            return result;
        } else {
            let result = [];
            for (let i = 0; i < parameters.length; i++) {
                result.push(session.unsubscribe(parameters[i], connection.smIdentifier));
            }
            return result;
        }
    }
    
    /* RPC API functions: administrative tasks */

    // eslint-disable-next-line no-unused-vars
    async listSessions(parameters, session) {
        var sessionList = [];
        for (var i in this.sessions) {
            sessionList.push(this.sessions[i].serialize());
        }
        return sessionList;
    }

    // eslint-disable-next-line no-unused-vars
    async destroySession(parameters, session) {
        return this._destroySession(parameters);
    }

    registerRpcMethods(rpc, prefix="session") {
        if (prefix!=="") prefix = prefix + "/";

        this._rpcMethodPrefix = prefix;
        
        /*
        * Create session
        * 
        * Returns a unique session token used to identify the session in further requests
        * 
        */
        rpc.addPublicMethod(
            prefix+"create",
            this.createSession.bind(this),
            null,
            {
                type: "string",
                description: "Session token"
            }
        );
        
        /*
        * Destroy the current session
        * 
        * Destroys the session attached to the request
        * 
        */
        rpc.addPublicMethod(
            prefix+"destroy",
            this.destroyCurrentSession.bind(this),
            null,
            {
                type: "boolean",
                description: "True when the session has succesfully been destroyed, false when the session could not be destroyed"
            }
        );
        
        /*
        * Query the state of the current session
        * 
        * Returns the state of the session attached to the request
        * 
        */
        rpc.addPublicMethod(
            prefix + "state",
            this.state.bind(this),
            null,
            {
                type: "object",
                description: "State of the session",
                properties: {
                    dateCreated: {
                        type: "number",
                        description: "Timestamp of the creation of this session"
                    },
                    subscriptions: {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        description: "Push message topics to which this session is subscribed"
                    },
                    user: {
                        type: "object",
                        description: "Serialized user or NULL when no user is available"
                    },
                    permissions: {
                        type: "array",
                        description: "List of methods which this session may call",
                        items: {
                            type: "string",
                            description: "Method which this session may call"
                        }
                    }
                },
                required: ["dateCreated", "subscriptions", "user", "permissions"]
            }
        );
        
        /*
        * Query permissions granted to the current session
        * 
        * Returns a list of permissions granted to the session attached to the request
        * 
        */
        rpc.addPublicMethod(
            prefix + "permissions",
            this.listPermissionsForCurrentSession.bind(this),
            null,
            {
                type: "array",
                description: "List of methods which this session may call",
                items: {
                    type: "string",
                    description: "Method which this session may call"
                }
            }
        );
        
        /* 
        * Pushmessages: list of subscriptions
        *
        * Returns the list of topics subscribed to the connection of the session attached to the request
        * 
        */
        rpc.addPublicMethod(
            prefix + "push/subscriptions",
            this.getSubscriptions.bind(this),
            null,
            {
                type: "array",
                description: "Array of topics which the session is subscribed to",
                items: {
                    type: "string",
                    description: "Topic"
                }
            }
        );
        
        /* 
        * Pushmessages: subscribe to a topic
        *
        * Adds the supplied topic to the list of topics subscribed to the connection of the session attached to the request
        * 
        */
        rpc.addPublicMethod(
            prefix + "push/subscribe",
            this.subscribe.bind(this),
            {
                anyOf: [
                    {
                        type: "string",
                        description: "Topic"
                    },
                    {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        description: "Array containing topics"
                    }
                ]
            },
            {
                anyOf: [
                    {
                        type: "boolean",
                        description: "True when successfully subscribed, false when already subscribed"
                    },
                    {
                        type: "array",
                        description: "Array of results",
                        items: {
                            type: "boolean",
                            description: "True when successfully subscribed, false when already subscribed"
                        }
                    }
                ]
            }
        );
        
        /*
        * Pushmessages: unsubscribe from a topic
        * 
        * Removes the supplied topic to the list of topics subscribed to the connection of the session attached to the request
        * 
        */
        rpc.addPublicMethod(
            prefix + "push/unsubscribe",
            this.unsubscribe.bind(this),
            {
                anyOf: [
                    {
                        type: "string",
                        description: "Topic"
                    },
                    {
                        type: "array",
                        items: {
                            type: "string",
                        },
                        description: "Array containing topics"
                    }
                ]
            },
            {
                anyOf: [
                    {
                        type: "boolean",
                        description: "True when successfully unsubscribed, false when already unsubscribed"
                    },
                    {
                        type: "array",
                        description: "Array of results",
                        items: {
                            type: "boolean", description: "True when successfully unsubscribed, false when already unsubscribed"
                        }
                    }
                ]
            }
        );
        
        /*
        * Management: list all active sessions
        * 
        * Returns a list of sessions
        * 
        */
        rpc.addMethod(
            prefix + "management/list",
            this.listSessions.bind(this),
            null,
            {
                type: "array",
                description: "List of serialized sessions",
                items: {
                    type: "object",
                    properties: {
                        id: {
                            type: "string"
                        },
                        user: {

                        },
                        dateCreated: {
                            type: "number"
                        },
                        dateLastUsed: {
                            type: "number"
                        },
                        subscriptions: {
                            type: "string"
                        },
                        permissions: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        },
                    }
                }
            }
        );
        
        /*
        * Management: destroy a session
        * 
        * Destroys the session corresponding to the supplied session token
        * 
        */
        rpc.addMethod(
            prefix + "management/destroy",
            this.destroySession.bind(this),
            {
                type: "string",
                description: "Unique identifier of the session that will be destroyed"
            },
            {
                type: "boolean",
                description: "True when a session was destroyed, false when no session with the supplied identifier exists"
            }
        );
    }
}

module.exports = SessionManager;
