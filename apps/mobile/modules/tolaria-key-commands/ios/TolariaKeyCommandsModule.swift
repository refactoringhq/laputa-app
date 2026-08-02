import ExpoModulesCore
import React
import UIKit

private let keyboardProbeLogPrefix = "TOLARIA_MOBILE_KEYBOARD_SHORTCUT_PROBE"
private let keyboardProbeEnvironmentName = "TOLARIA_MOBILE_KEYBOARD_SHORTCUT_PROBE"
private let mobileSearchEnvironmentName = "TOLARIA_MOBILE_SEARCH"

private struct TolariaKeyCommand {
  let action: String
  let altKey: Bool
  let code: String
  let ctrlKey: Bool
  let input: String
  let key: String
  let metaKey: Bool
  let modifierFlags: UIKeyModifierFlags
  let shiftKey: Bool
}

public class TolariaKeyCommandsModule: Module {
  private var registered = false
  private let commands: [TolariaKeyCommand] = [
    TolariaKeyCommand(
      action: "commandPalette",
      altKey: false,
      code: "KeyK",
      ctrlKey: false,
      input: "k",
      key: "k",
      metaKey: true,
      modifierFlags: .command,
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "findInNote",
      altKey: false,
      code: "KeyF",
      ctrlKey: false,
      input: "f",
      key: "f",
      metaKey: true,
      modifierFlags: .command,
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "search",
      altKey: false,
      code: "KeyO",
      ctrlKey: false,
      input: "o",
      key: "o",
      metaKey: true,
      modifierFlags: .command,
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "search",
      altKey: false,
      code: "KeyP",
      ctrlKey: false,
      input: "p",
      key: "p",
      metaKey: true,
      modifierFlags: .command,
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "toggleRawEditor",
      altKey: false,
      code: "Backslash",
      ctrlKey: false,
      input: "\\",
      key: "\\",
      metaKey: true,
      modifierFlags: .command,
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "createNote",
      altKey: false,
      code: "KeyN",
      ctrlKey: false,
      input: "n",
      key: "n",
      metaKey: true,
      modifierFlags: .command,
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "previousNote",
      altKey: false,
      code: "ArrowUp",
      ctrlKey: false,
      input: UIKeyCommand.inputUpArrow,
      key: "ArrowUp",
      metaKey: false,
      modifierFlags: [],
      shiftKey: false
    ),
    TolariaKeyCommand(
      action: "nextNote",
      altKey: false,
      code: "ArrowDown",
      ctrlKey: false,
      input: UIKeyCommand.inputDownArrow,
      key: "ArrowDown",
      metaKey: false,
      modifierFlags: [],
      shiftKey: false
    )
  ]

  public func definition() -> ModuleDefinition {
    Name("TolariaKeyCommands")

    Events("onShortcut")

    Function("isSupported") {
      return true
    }

    Function("launchArguments") {
      return ProcessInfo.processInfo.arguments
    }

    Function("environmentValue") { (name: String) -> String? in
      return ProcessInfo.processInfo.environment[name]
    }

    OnStartObserving("onShortcut") {
      self.registerCommands()
    }

    OnStopObserving("onShortcut") {
      self.unregisterCommands()
    }
  }

  private func registerCommands() {
    runOnMain {
      guard !self.registered else { return }

      // RCTKeyCommands is simulator-only: its implementation sits behind
      // `#if RCT_DEV && (TARGET_OS_SIMULATOR || TARGET_OS_MACCATALYST)` and the
      // fallback `sharedInstance` returns nil. Objective-C leaves that return
      // unannotated, so Swift imports it implicitly unwrapped and calling
      // through it traps the process — a physical iPad crashed at launch rather
      // than simply going without native shortcuts.
      guard let keyCommands = RCTKeyCommands.sharedInstance() else { return }

      for command in self.commands {
        keyCommands.registerKeyCommand(
          withInput: command.input,
          modifierFlags: command.modifierFlags
        ) { [weak self] _ in
          self?.sendShortcut(command)
        }
      }

      self.registered = true
      self.logKeyboardProbe([
        "kind": "bridge",
        "nativeModuleAvailable": true
      ])
    }
  }

  private func unregisterCommands() {
    runOnMain {
      guard self.registered else { return }

      // Unreachable while `registered` is true — nothing registers without a
      // live instance — but the same implicit unwrap would trap here too.
      guard let keyCommands = RCTKeyCommands.sharedInstance() else {
        self.registered = false
        return
      }

      for command in self.commands {
        keyCommands.unregisterKeyCommand(
          withInput: command.input,
          modifierFlags: command.modifierFlags
        )
      }

      self.registered = false
    }
  }

  private func sendShortcut(_ command: TolariaKeyCommand) {
    logKeyboardProbe([
      "action": command.action,
      "altKey": command.altKey,
      "code": command.code,
      "ctrlKey": command.ctrlKey,
      "kind": "action",
      "key": command.key,
      "metaKey": command.metaKey,
      "shiftKey": command.shiftKey,
      "source": "native"
    ])
    sendEvent("onShortcut", [
      "action": command.action,
      "altKey": command.altKey,
      "code": command.code,
      "ctrlKey": command.ctrlKey,
      "key": command.key,
      "metaKey": command.metaKey,
      "shiftKey": command.shiftKey,
      "source": "native"
    ])
  }

  private func runOnMain(_ action: @escaping () -> Void) {
    if Thread.isMainThread {
      action()
    } else {
      DispatchQueue.main.async(execute: action)
    }
  }

  private func logKeyboardProbe(_ proof: [String: Any]) {
    guard keyboardProbeLoggingEnabled() else { return }

    guard
      let data = try? JSONSerialization.data(withJSONObject: proof),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }

    NSLog("%@ %@", keyboardProbeLogPrefix, json)
  }

  private func keyboardProbeLoggingEnabled() -> Bool {
    let environment = ProcessInfo.processInfo.environment

    return environment[keyboardProbeEnvironmentName] == "1"
      || environment[mobileSearchEnvironmentName]?.contains("mobileKeyboardShortcutProbe=1") == true
  }
}
