/**
 * 按照ES6的Promise或符合Promise/A+规范的对象，实现一致的功能。
 * @copyright Copyright(c) 2017 listenlin.
 * @author listenlin <listenlin521@foxmail.com>
 */
import 'babel-polyfill';

const PromiseValue = Symbol('PromiseValue');
const PromiseStatus = Symbol('PromiseStatus');

const onFulfillMap = new Map(); // 储存某个promise的fulfilled状态监听函数。
const onRejectMap = new Map(); // 储存某个promise的rejected状态监听函数。

// 以当前promise对象为key, 下一个链式promise对象(then调用时返回)为value。
const nextPromiseMap = new Map();

/**
 * 判断一个值是否是thenable对象。
 * 
 * @param {any} result - 需判断的值
 * @returns {Function|Boolean} 如果是一个thenable，返回then函数，否则返回false。
 */
const isThenable = (result)=>{
    if (typeof result !== 'undefined' && result) {
        const then = result.then; // 注意：如果then是个属性，只允许调用一次。
        if (typeof then === 'function') {
            return then.bind(result);
        }
    }
    return false;
}

/**
 * 执行promise状态的监听器
 * 
 * @param {Promise} promise - 需要执行回调的promise对象。
 * @param {any} result - 结果值或异常原因值
 * @param {Boolean} status - 执行reject为true, resolve为false.
 * @returns
 */
const executeCallback = (promise, result, status)=>{
    const onCallbackMap = status ? onFulfillMap : onRejectMap;
    const callbacks = onCallbackMap.get(promise);
    const nextPromises = nextPromiseMap.get(promise);
    // 提前将已执行过的回调函数都丢弃掉，重置为空队列。以免回调中注册的被丢弃掉。
    onCallbackMap.set(promise, []);
    nextPromiseMap.set(promise, []);
    const executedCallbacks = callbacks.filter((callback, index)=>{
        let callbackResult = result;
        let isFulfill = status;
        const isFunction = typeof callback === 'function';
        if (isFunction) {
            try{
                callbackResult = callback.call(undefined, result); 
                isFulfill = true; // 只要没有异常，后续都去执行resolve.
            } catch (e) {
                callbackResult = e;
                isFulfill = false;
            }
        }
        const nextPromise = nextPromises[index];
        // 更改下个promise的状态。
        if (nextPromise instanceof Promise) {
            (isFulfill ? resolve : reject).call(nextPromise, callbackResult);
        }
        return isFunction;
    });

    if (!status && executedCallbacks.length === 0) {
        // 没有注册rejected状态回调函数，直接抛出异常错误。
        // throw result;
    }
}

/**
 * 获取一个可兼容浏览器和node环境的延迟至栈尾执行的函数。
 * 如果不支持，将在下个事件循环执行。
 * 
 * @param {Function} fn - 需要延迟的函数
 * @param {...any} [args] - 需要依次传入延迟函数的参数 
 */
const delayFunc = (()=>{
    if (typeof process !== 'undefined' && process.nextTick) {
        return process.nextTick;
    }
    if (typeof setImmediate === 'function') {
        return setImmediate;
    }
    return (fn, ...p)=>setTimeout(fn, 0, ...p);
})();

/**
 * 根据传来的promise对象当前状态，异步执行其状态的回调函数。
 * 
 * @param {Promise} promise - 需要去更改状态的primise对象
 */
const delayToNextTick = promise=>{
    delayFunc(
        executeCallback,
        promise,
        promise[PromiseValue], 
        promise[PromiseStatus] === 'fulfilled'
    );
}

/**
 * 高级函数，让传入的函数只能被执行一次。
 * 
 * @param {Function} fn - 需要只执行一次的函数
 * @param {any} [context=undefined] - 执行函数时，其this变量指向谁。
 * @returns {Function}
 */
const executeOnce = (fn, context = undefined)=>{
    let once = false;
    return (...p)=>{
        if (!once) {
            once = true;
            return fn.call(context, ...p);
        }
    }
};

/**
 * 解析promise流程
 * [[Resolve]](promise, x)
 * https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure 官方提供流程算法
 * 
 * @param {Promise} promise - 需要解析的promise对象
 * @param {any} x - 用户传来的值，通过resolve或resolvePromise参数、onFulfilled返回值传入。
 */
const resolutionProcedure = (promise, x)=>{
    if (promise instanceof Promise && promise === x) {
        return reject.call(promise, new TypeError());
    }
    if (x instanceof Promise) {
        if (x[PromiseStatus] === 'pending') {
            x.then(executeOnce(resolve, promise), executeOnce(reject, promise));
        } else {
            promise[PromiseValue] = x[PromiseValue];
            promise[PromiseStatus] = x[PromiseStatus];
            delayToNextTick(promise);
        }
        return;
    }
    if (x && (typeof x === 'object' || typeof x === 'function')) {
        try{
            const then = x.then;
            if (typeof then === 'function') {
                return then.call(x, executeOnce(resolve, promise), executeOnce(reject, promise));
            }
        } catch(e) {
            return reject.call(promise, e);
        }
    }
    promise[PromiseStatus] = 'fulfilled';
    promise[PromiseValue] = x;
    delayToNextTick(promise);
}

/**
 * 将状态转移至fulfilled。
 * 因为需要动态更改其this，所以function申明，而不是箭头函数。
 * 
 * @param {any} result - 传回的promise结果值
 * @returns 
 */
const resolve = function(result) {
    if (this[PromiseStatus] !== 'pending') return;
    resolutionProcedure(this, result);
}

/**
 * 将状态转移至rejected。
 * 因为需要动态更改其this，所以function申明，而不是箭头函数。
 * 
 * @param {Error} error - 错误原因对象
 * @returns 
 */
const reject = function(error) {
    if (this[PromiseStatus] !== 'pending') return;

    this[PromiseStatus] = 'rejected';
    this[PromiseValue] = error;

    delayToNextTick(this);
}

/**
 * 按照ES6规范实现。
 * 
 * @class Promise
 */
class Promise
{
    /**
     * Creates an instance of Promise.
     * @param {Function} fn
     * 
     * @memberOf Promise
     */
    constructor(fn)
    {
        this[PromiseStatus] = 'pending';//fulfilled, rejected
        this[PromiseValue] = undefined;

        onFulfillMap.set(this, []);
        onRejectMap.set(this, []);
        nextPromiseMap.set(this, []);
        
        if (typeof fn === 'function') {
            try{
                fn(executeOnce(resolve, this), executeOnce(reject, this));
            } catch(e) {
                reject.call(this, e);
            }
        }
    }

    /**
     * 注册回调方法
     * 
     * @param {Function} onFulfilled 
     * @param {Function} onRejected 
     * @returns {Promise}
     * 
     * @memberOf Promise
     */
    then(onFulfilled, onRejected)
    {
        onFulfillMap.get(this).push(onFulfilled);
        onRejectMap.get(this).push(onRejected);
        if (this[PromiseStatus] !== 'pending') delayToNextTick(this);

        const nextPromise = new Promise();
        nextPromiseMap.get(this).push(nextPromise);

        return nextPromise;
    }

    /**
     * 注册异常回调
     * 
     * @param {Function} onRejected 
     * @returns {Promise}
     * 
     * @memberOf Promise
     */
    catch(onRejected)
    {
        return this.then(null, onRejected);
    }

    get[Symbol.toStringTag]() {
        return 'Promise';
    }

}

Promise.resolve = (result)=>{
    if (result instanceof Promise) {
        return result;
    }
    let promise;
    try{
        const then = isThenable(result);
        if (then) {
            promise = new Promise(then);
        } else {
            promise = new Promise(resolve => resolve(result));
        }
    } catch(e) {
        if (promise) {
            reject.call(promise, e);
        } else {
            promise = Promise.reject(e);
        }
    }
    return promise;
};

Promise.reject = (error)=>{
    return new Promise((resolve, reject) => reject(error));
};

Promise.all = function() {

}

Object.freeze(Promise);

export default Promise;