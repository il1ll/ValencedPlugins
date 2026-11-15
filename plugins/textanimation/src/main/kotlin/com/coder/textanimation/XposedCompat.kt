package com.coder.textanimation

import android.util.Log
import app.valenced.plugins.PluginBuilder
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Member
import java.lang.reflect.Method
import java.util.concurrent.ConcurrentHashMap

internal abstract class XC_MethodHook {
	protected open fun beforeHookedMethod(param: MethodHookParam) = Unit
	protected open fun afterHookedMethod(param: MethodHookParam) = Unit

	internal fun runBefore(param: MethodHookParam) = beforeHookedMethod(param)
	internal fun runAfter(param: MethodHookParam) = afterHookedMethod(param)

	class MethodHookParam internal constructor(private val scope: Any) {
		val thisObject: Any? get() = Host.call(Host.getThis, scope)
		@Suppress("UNCHECKED_CAST")
		val args: Array<Any?> get() = Host.call(Host.getArgs, scope) as Array<Any?>
		var result: Any?
			get() = Host.call(Host.getResult, scope)
			set(value) { Host.call(Host.setResult, scope, value) }
		var throwable: Throwable?
			get() = Host.call(Host.getThrowable, scope) as Throwable?
			set(value) { Host.call(Host.setThrowable, scope, value) }

		private val param: Any by lazy { Host.call(Host.getParam, scope)!! }
		fun getObjectExtra(key: String): Any? = Host.call(Host.extraMethod(param, "getObjectExtra", 1), param, key)
		fun setObjectExtra(key: String, value: Any?) {
			Host.call(Host.extraMethod(param, "setObjectExtra", 2), param, key, value)
		}
	}

	fun interface Unhook {
		fun unhook()
	}
}

internal object XposedBridge {
	fun hookMethod(member: Member, hook: XC_MethodHook): XC_MethodHook.Unhook {
		val builder = Host.builderCtor.newInstance()
		if (Host.overrides(hook.javaClass, "beforeHookedMethod")) {
			Host.call(Host.before, builder, { scope: Any -> hook.runBefore(XC_MethodHook.MethodHookParam(scope)) })
		}
		if (Host.overrides(hook.javaClass, "afterHookedMethod")) {
			Host.call(Host.after, builder, { scope: Any -> hook.runAfter(XC_MethodHook.MethodHookParam(scope)) })
		}
		val built = Host.call(Host.build, builder)!!
		val unhook = Host.call(Host.hookMethod, null, member, built)!!
		val unhookMethod = unhook.javaClass.getMethod("unhook")
		return XC_MethodHook.Unhook { Host.call(unhookMethod, unhook) }
	}

	fun log(text: String) {
		runCatching { Host.call(Host.log, null, text) }.onFailure { Log.i("ValencedPlugin", text) }
	}
}

internal object XposedHelpers {
	private val methods = ConcurrentHashMap<String, Method>()

	fun callMethod(target: Any?, name: String, vararg args: Any?): Any? {
		if (target == null) throw NullPointerException("callMethod $name on null")
		val key = "${target.javaClass.name}#$name/${args.size}"
		val method = methods.getOrPut(key) {
			target.javaClass.methods.firstOrNull { it.name == name && it.parameterCount == args.size }
				?: throw NoSuchMethodException("${target.javaClass.name}.$name/${args.size}")
		}
		return Host.call(method, target, *args)
	}
}

private object Host {
	private val loader = PluginBuilder::class.java.classLoader!!
	private val builderClass = loader.loadClass("app.valenced.xposed.MethodHookBuilder")
	private val scopeClass = loader.loadClass("app.valenced.xposed.HookScope")

	val builderCtor = builderClass.getDeclaredConstructor().apply { isAccessible = true }
	val before: Method = builderClass.getMethod("before", Function1::class.java)
	val after: Method = builderClass.getMethod("after", Function1::class.java)
	val build: Method = builderClass.getMethod("build")

	val getThis: Method = scopeClass.getMethod("getThisObject")
	val getArgs: Method = scopeClass.getMethod("getArgs")
	val getResult: Method = scopeClass.getMethod("getResult")
	val setResult: Method = scopeClass.getMethod("setResult", Any::class.java)
	val getThrowable: Method = scopeClass.getMethod("getThrowable")
	val setThrowable: Method = scopeClass.getMethod("setThrowable", Throwable::class.java)
	val getParam: Method = scopeClass.getMethod("getParam")

	private val hookClass: Class<*> = run {
		var c: Class<*> = call(build, builderCtor.newInstance())!!.javaClass
		while (c.superclass != null && c.simpleName != "XC_MethodHook") c = c.superclass!!
		c
	}
	private val bridge = Class.forName("${hookClass.name.substringBeforeLast('.')}.XposedBridge", false, hookClass.classLoader)
	val hookMethod: Method = bridge.getMethod("hookMethod", Member::class.java, hookClass)
	val log: Method = bridge.getMethod("log", String::class.java)

	private val extras = ConcurrentHashMap<String, Method>()

	fun extraMethod(param: Any, name: String, count: Int): Method = extras.getOrPut(name) {
		param.javaClass.methods.first { it.name == name && it.parameterCount == count }
	}

	fun overrides(hookClass: Class<*>, name: String): Boolean {
		var c: Class<*>? = hookClass
		while (c != null && c != XC_MethodHook::class.java) {
			if (c.declaredMethods.any { it.name == name }) return true
			c = c.superclass
		}
		return false
	}

	fun call(method: Method, target: Any?, vararg args: Any?): Any? = try {
		method.invoke(target, *args)
	} catch (e: InvocationTargetException) {
		throw e.targetException
	}
}
