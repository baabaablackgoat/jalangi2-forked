/*
 * Copyright 2014 Samsung Information Systems America, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Author: Koushik Sen

// do not remove the following comment
// JALANGI DO NOT INSTRUMENT

/**
 * @file Trace generator for race detection. Modified off of the Jalangi2 template analysis.
 * @author  Niklas Meuter, Koushik Sen
 *
 */

(function (sandbox) {
    /**
     * Implements the file system operations and is intended as an abstraction layer to the
     * actual trace construction.
     */
    class TraceLogger {
        nodeWriteStream;
        browserWriteStream;
        browserFileHandle;
        // Intentionally initialized as 1 - the base script is intended to be EventFrame 0.
        browserWriteLocation = 1;
        browserEncoder;
        fs;
        cache = [];
        writerReady = false;
        loggingEnabled = true;



        constructor(fileTarget = undefined) {
            const dateString = new Date().toISOString().replace(":", "-");
            if (!fileTarget) fileTarget = `trace_${dateString}.log`

            if (sandbox.Constants.isBrowser) {
                // Problem: getting access to the file system from the browser is inherently asynchronous.
                // This means that we have to create an async factory, and cache all logs until the factory
                // has finished execution.
                void this.browserLogFactory(fileTarget);
            } else { // node.js
                this.fs = require("fs");
                // This operation may throw if file access is not granted, which will immediately halt the
                // instrumented code with an error message.
                this.nodeWriteStream = this.fs.createWriteStream(fileTarget);
                this.writerReady = true;
            }

        }

        /** Asynchronously performs the necessary operations to create a filestream within the browser.
         * Once it has finished, writerReady and flush() is called.
         * @private
         */
        async browserLogFactory(fileTarget) {
            const OPFSDirectory = await navigator.storage.getDirectory();
            this.browserFileHandle = await OPFSDirectory.getFileHandle(fileTarget, {create: true});
            // this would be the ideal approach, but seems to break on localhost.
            // My understanding is that this could in theory be fixed by correctly providing this as a proper webserver with a
            // correctly installed Cert Auth
            // this.browserWriteStream = await draftHandle.createSyncAccessHandle();
            this.browserWriteStream = await this.browserFileHandle.createWritable();
            // Create the other necessary helpers
            this.browserEncoder = new TextEncoder();
            // Mark the stream as ready to accept data.
            this.writerReady = true;
            // Attempt to flush the cached log entries immediately.
            void this.flushCache();
        }

        /**
         * Logs the contents of the string by either appending them to a file in node.js contexts,
         * or adds them to memory that can later be saved as a blob by the user from the browser.
         * @private
         */
        logEvent(logString) {
            if (!this.loggingEnabled) return;
            // Ensure the string ends with a newline.
            if (!logString.endsWith("\n")) {
                logString += "\n"
            }
            if (!this.writerReady) {
                // The writer is not ready yet.
                // Add the event to the temporary cache and then continue on.
                this.cache.push(logString);
                return;
            }
            if (this.cache.length > 0) {
                // The cache has not been emptied yet, but the writer is ready.
                // First append the event to the cache, then attempt to flush the cache.
                this.cache.push(logString);
                void this.flushCache();
            }
            this.writeData(logString);
        }

        /**
         * Writes the passed data to the respective data stream.
         * @param dataString The trace data to write.
         * @private
         */
        writeData(dataString) {
            if (sandbox.Constants.isBrowser) {
                this.browserWriteStream.write(dataString);
                // This would be the correct OPFS implementation, but seems to break in localhost context.
                // const encodedMessage = this.browserEncoder.encode(dataString);
                // const addedDataSize = this.browserWriteStream.write(encodedMessage, {at: this.browserWriteLocation});
                // this.browserWriteLocation += addedDataSize;
            } else {
                this.nodeWriteStream.write(dataString);
            }
        }

        /**
         * Attempts to flush the current cache of traced events.
         * This should in theory flush the entire cache at once, but could in practice not keep
         * up with incoming logs. In the most likely scenario, this will execute exactly once.
         * @returns {Promise<void>}
         * @private
         */
        async flushCache() {
            console.log("TRACER: Trace cache is being flushed.", this.cache);
            let cacheLengthOnInitiation = this.cache.length;
            this.writeData(this.cache.slice(0, cacheLengthOnInitiation).join(""));
            // Ensure that we remove only all definitely logged cached events, since in theory
            // further events might have been cached in the meantime.
            this.cache = this.cache.slice(cacheLengthOnInitiation);
        }

        /**
         * Stop the trace, ensure that all still cached events are logged, and finally close all open file streams.
         * @returns {Promise<void>}
         */
        async finishLogging() {
            console.log("Tracer is terminating. (browser: Alt+Shift+T triggered)");
            // Stop any further logs.
            this.loggingEnabled = false;
            if (!this.writerReady) {
                console.error("Logging is supposed to finish but the writer is still not ready yet. Something must have gone wrong while initalization, no trace may be available.");
            }
            // If the cache for some reason has not been emptied, perform a final flush.
            if (this.cache.length > 0) await this.flushCache();
            // Close streams to store data to disk
            if (sandbox.Constants.isBrowser) {
                // wait for the write stream to close before doing anything else, this definitively writes the file to disk
                await this.browserWriteStream.close();
                // attempt to open the OPFS-stored file in a new tab
                const outputFile = await this.browserFileHandle.getFile();
                console.log("Attempting to open trace file in new tab. File object:", outputFile);
                window.open(window.URL.createObjectURL(outputFile));
            } else {
                this.nodeWriteStream.close();
            }
        }

        /**
         * Log a read event.
         * @param eventActionId The EventAction that has invoked the read event.
         * @param variableTarget The variable (name) that was read.
         * @param codeLocation The code location this event occurred at.
         */
        logRead(eventActionId, variableTarget, codeLocation) {
            this.logEvent(`T${eventActionId}|r(${variableTarget})|${codeLocation}`)
        }

        /**
         * Log a write event.
         * @param eventActionId The EventAction that has invoked the write event.
         * @param variableTarget The variable (name) that was written to.
         * @param codeLocation The code location this event occurred at.
         */
        logWrite(eventActionId, variableTarget, codeLocation) {
            this.logEvent(`T${eventActionId}|w(${variableTarget})|${codeLocation}`)
        }

        /**
         * Log a fork event (as in an EventAction has created another EventAction)
         * @param originEventAction The EventAction that has commenced the fork.
         * @param forkedEventAction The newly forked/created EventAction.
         * @param codeLocation The code location this event occurred at.
         */
        logFork(originEventAction, forkedEventAction, codeLocation) {
            this.logEvent(`T${originEventAction}|fork(${forkedEventAction})|${codeLocation}`)
        }

        /**
         * Log a join event (an EventAction is awaiting the end of execution of another)
         * @param pendingEventAction The EventAction that has been stopped from further execution.
         * @param awaitedEventAction The EventAction that needs to finish execution before the previous may continue.
         * @param codeLocation The code location this event occurred at.
         */
        logJoin(pendingEventAction, awaitedEventAction, codeLocation) {
            this.logEvent(`T${pendingEventAction}|fork(${awaitedEventAction})|${codeLocation}`)
        }

        /**
         * Log the acquiring of a lock.
         * @param eventActionId The EventAction that has acquired the lock.
         * @param lockName The name of the acquired lock.
         * @param codeLocation The code location this event occurred at.
         */
        logAcquire(eventActionId, lockName, codeLocation) {
            this.logEvent(`T${eventActionId}|acq(${lockName})|${codeLocation}`);
        }

        /**
         * Log the release of a lock (which automatically occurs once the callback of the lock acquiring has completed)
         * @param eventActionId The EventAction that has terminated, releasing the lock.
         * @param lockName The name of the released lock.
         * @param codeLocation The code location this event occurred at.
         */
        logRelease(eventActionId, lockName, codeLocation) {
            this.logEvent(`T${eventActionId}|rel(${lockName})|${codeLocation}`);
        }


    }

    /**
     * Implements the EventAction driven Event Tracer as a Jalangi2 instrumentation.
     * Note that this constructor was intentionally left as the "old" syntax over the now typical class implementation.
     * This seems to unfortunately be necessary.
     * @constructor
     */
    function EventActionAnalysis() {
        /**
         * To emulate the concept of threads in JavaScript, which is an event based language, we use the concept of EventActions.
         * (see Effective Race Detection for Event-Driven Programs, https://dl.acm.org/doi/10.1145/2509136.2509538)
         * This value is incremented and then assigned to every function invocation, creating unique EventAction IDs.
         * @type {number}
         */
        let lastEventActionId = 0;
        let traceLogger = new TraceLogger();

        /**
         * This abstracts the assignment of the EventAction ID.
         * Simply put: Assign the returned value to the EventAction, then increment it for the next one.
         * @returns {number}
         */
        function assignEventActionId() {
            return lastEventActionId++;
        }

        /**
         * Returns the EventAction ID of the passed shadow frame.
         * If the property is not set, the function assumes we are at the top level, and returns 0.
         * @param shadowFrame The frame to parse.
         * @returns {number} The EventAction ID. 0 or greater.
         */
        function getEventActionId(shadowFrame) {
            return shadowFrame["eventAction"] ?? 0;
        }

        /**
         * Helper function that wraps the sandbox and iid location determiner.
         */
        function getCodeLocation(iid) {
            return sandbox.iidToLocation(sandbox.sid, iid)
        }

        /**
         * Invoked before a function is executed.
         * In the context of the tracer, we consider function invocations as the entrypoint to EventActions.
         * Therefore, we assign the execution of every function a new EventAction id, and store it in its respective
         * shadow frame to retrieve later.
         */
        this.invokeFunPre = function (iid, f, base, args, isConstructor, isMethod, functionIid, functionSid) {
            const shadowFrame = sandbox.smemory.getShadowFrame('this');
            const newActionId = assignEventActionId();
            shadowFrame["eventAction"] = newActionId;
            traceLogger.logFork(getEventActionId(sandbox.smemory.getShadowFrame(base)), newActionId, getCodeLocation(iid));
        };
        function baseReadable(base) {
            // Functions in Jalangi are returned as the entire thing. We only care about the function name.
            if (typeof base === "function") {
                return base.name;
            }
            // Objects will get broken down to [Object object] if directly stringified. Get the constructor name instead.
            if (typeof base === "object") {
                return base.constructor.name;
            }
            return base;
        }

        function offsetReadable(offset) {
            if (typeof offset === "symbol") {
                return offset.toString();
            }
            return offset;
        }

        /**
         * This callback is called before a property of an object is accessed.
         * We can use this to:
         * - detect reads on object properties
         * - detect usage of the Lock API / lock acquiring
         * - potentially detect other object accesses.
         * Reads are logged as a combination of base + property.
         *
         * @param {number} iid - Static unique instruction identifier of this callback
         * @param {*} base - Base object
         * @param {string|*} offset - Property
         * @param {boolean} isComputed - True if property is accessed using square brackets.  For example,
         * <tt>isComputed</tt> is <tt>true</tt> if the get field operation is <tt>o[p]</tt>, and <tt>false</tt>
         * if the get field operation is <tt>o.p</tt>
         * @param {boolean} isOpAssign - True if the operation is of the form <code>o.p op= e</code>
         * @param {boolean} isMethodCall - True if the get field operation is part of a method call (e.g. <tt>o.p()</tt>)
         * @returns {{base: *, offset: *, skip: boolean} | undefined} - If an object is returned and the <tt>skip</tt>
         * property of the object is true, then the get field operation is skipped.  Original <tt>base</tt> and
         * <tt>offset</tt> are replaced with that from the returned object if an object is returned.
         *
         */
        this.getFieldPre = function (iid, base, offset, isComputed, isOpAssign, isMethodCall) {
            const shadowFrame = sandbox.smemory.getShadowFrame('this');
            // Method calls can be filtered - we only really care about "reads".
            // However, we do care about calls on the LockManager.
            // Also, as of Node.js 20.1, LockManager is NOT implemented into base js yet.
            // The relevant repo that will eventually be merged is https://github.com/metarhia/web-locks
            if (sandbox.Constants.isBrowser && isMethodCall && base instanceof LockManager) {
                if (offset === "request") {
                    // TODO: For some reason, it is just not possible to find the actual function parameters in the offset.
                    //  I have yet to find a way to actually determine how to reach those values.
                    //  My best bet is to move the actual logging to functionCall listeners, and listen to the shadow frame.
                    traceLogger.logAcquire(getEventActionId(shadowFrame), "todo", getCodeLocation(iid))
                }
            } else {
                traceLogger.logRead(getEventActionId(shadowFrame), `${baseReadable(base)}.${offsetReadable(offset)}`, getCodeLocation(iid))
            }
        };

        /**
         * This callback is called before a property of an object is written.
         * We can use this to detect writes to objects/properties, and will treat them as such.
         * Writes are logged as a combination of base + offset.
         *
         * @param {number} iid - Static unique instruction identifier of this callback
         * @param {*} base - Base object
         * @param {*} offset - Property
         * @param {*} val - Value to be stored in <code>base[offset]</code>
         * @param {boolean} isComputed - True if property is accessed using square brackets.  For example,
         * <tt>isComputed</tt> is <tt>true</tt> if the get field operation is <tt>o[p]</tt>, and <tt>false</tt>
         * if the get field operation is <tt>o.p</tt>
         * @param {boolean} isOpAssign - True if the operation is of the form <code>o.p op= e</code>
         * @returns {{base: *, offset: *, val: *, skip: boolean} | undefined} -  If an object is returned and the <tt>skip</tt>
         * property is true, then the put field operation is skipped.  Original <tt>base</tt>, <tt>offset</tt>, and
         * <tt>val</tt> are replaced with that from the returned object if an object is returned.
         */
        this.putFieldPre = function (iid, base, offset, val, isComputed, isOpAssign) {
            const shadowFrame = sandbox.smemory.getShadowFrame('this');
            // const shadowObj = sandbox.smemory.getShadowObject(base, offset, false);
            traceLogger.logWrite(getEventActionId(shadowFrame), `${baseReadable(base)}.${offsetReadable(offset)}`, getCodeLocation(iid))
        };

        /**
         * This callback is called after a variable is read.
         * This will raise a read event in the tracer.
         *
         * @param {number} iid - Static unique instruction identifier of this callback
         * @param {string} name - Name of the variable being read
         * @param {*} val - Value read from the variable
         * @param {boolean} isGlobal - True if the variable is not declared using <tt>var</tt> (e.g. <tt>console</tt>)
         * @param {boolean} isScriptLocal - True if the variable is declared in the global scope using <tt>var</tt>
         * @returns {{result: *} | undefined} - If an object is returned, the result of the read operation is
         * replaced with the value stored in the <tt>result</tt> property of the object.
         */
        this.read = function (iid, name, val, isGlobal, isScriptLocal) {
            const shadowFrame = sandbox.smemory.getShadowFrame(name); // Shadow frame is associated to the variable name!
            traceLogger.logRead(getEventActionId(shadowFrame), name, getCodeLocation(iid))
        };

        /**
         * This callback is called before a variable is written.
         * This will raise a write event in the tracer.
         *
         * @param {number} iid - Static unique instruction identifier of this callback
         * @param {string} name - Name of the variable being read
         * @param {*} val - Value to be written to the variable
         * @param {*} lhs - Value stored in the variable before the write operation
         * @param {boolean} isGlobal - True if the variable is not declared using <tt>var</tt> (e.g. <tt>console</tt>)
         * @param {boolean} isScriptLocal - True if the variable is declared in the global scope using <tt>var</tt>
         * @returns {{result: *} | undefined} - If an object is returned, the result of the write operation is
         * replaced with the value stored in the <tt>result</tt> property of the object.
         */
        this.write = function (iid, name, val, lhs, isGlobal, isScriptLocal) {
            const shadowFrame = sandbox.smemory.getShadowFrame(name); // Shadow frame is associated to the variable name!
            traceLogger.logWrite(getEventActionId(shadowFrame), name, getCodeLocation(iid));
        };

        /**
         * This callback is called before the execution of a function body starts.
         *
         * @param {number} iid - Static unique instruction identifier of this callback
         * @param {function} f - The function object whose body is about to get executed
         * @param {*} dis - The value of the <tt>this</tt> variable in the function body
         * @param {Array} args - List of the arguments with which the function is called
         * @returns {undefined} - Any return value is ignored
         */
        this.functionEnter = function (iid, f, dis, args) {
            // TODO: This doesn't work. I don't know why it doesn't work. It just won't. It's all inconsistent.
            // const shadowFrame = sandbox.smemory.getShadowFrame("this");
            // if (shadowFrame["isLockRequest"] !== undefined) {
                // TODO: Move the lock acquire logging down here, as we would probably get access to the args from here
            //}
        };

        /**
         * This callback is called when the execution of a function body completes.
         * We listen to this callback to ensure that a callback resulting from a lock acquiry completing
         * is logged as the associated lock getting released.
         *
         * @param {number} iid - Static unique instruction identifier of this callback
         * @param {*} returnVal - The value returned by the function
         * @param {{exception:*} | undefined} wrappedExceptionVal - If this parameter is an object, the function
         * execution has thrown an uncaught exception and the exception is being stored in the <tt>exception</tt>
         * property of the parameter
         * @returns {{returnVal: *, wrappedExceptionVal: *, isBacktrack: boolean}}  If an object is returned, then the
         * actual <tt>returnVal</tt> and <tt>wrappedExceptionVal.exception</tt> are replaced with that from the
         * returned object. If an object is returned and the property <tt>isBacktrack</tt> is set, then the control-flow
         * returns to the beginning of the function body instead of returning to the caller.  The property
         * <tt>isBacktrack</tt> can be set to <tt>true</tt> to repeatedly execute the function body as in MultiSE
         * symbolic execution.
         */
        this.functionExit = function (iid, returnVal, wrappedExceptionVal) {
            const shadowFrame = sandbox.smemory.getShadowFrame("this");
            if (shadowFrame["associatedLock"] !== undefined) {
                traceLogger.logRelease(getEventActionId(shadowFrame), shadowFrame["associatedLock"], getCodeLocation(iid))
            }
        };

        /**
         * This callback is called when an execution terminates in node.js.  In a browser environment, the callback is
         * called if ChainedAnalyses.js or ChainedAnalysesNoCheck.js is used and Alt-Shift-T is pressed.
         * In the tracer context, we stop the trace at this point.
         *
         * @returns {undefined} - Any return value is ignored
         */
        this.endExecution = function () {
            void traceLogger.finishLogging();
        };

        /**
         * onReady is useful if your analysis is running on node.js (i.e., via the direct.js or jalangi.js commands)
         * and needs to complete some asynchronous initialization before the instrumented program starts.  In such a
         * case, once the initialization is complete, invoke the cb function to start execution of the instrumented
         * program.
         *
         * Note that this callback is not useful in the browser, as Jalangi has no control over when the
         * instrumented program runs there.
         * @param cb
         */
        this.onReady = function (cb) {
            cb();
        };
    }

    sandbox.analysis = new EventActionAnalysis();
})(J$);



