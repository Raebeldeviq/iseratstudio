import Foundation
import Security

func fail(_ message: String, status: OSStatus? = nil) -> Never {
    let detail = status.flatMap { SecCopyErrorMessageString($0, nil) as String? }
    let output = detail.map { "\(message): \($0)" } ?? message
    FileHandle.standardError.write(Data((output + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 5 else {
    fail("Ungültiger Aufruf des macOS-Schlüsselbundhelfers")
}

let action = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
let account = CommandLine.arguments[3]
let accessibility = CommandLine.arguments[4]
let baseQuery: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

switch action {
case "save":
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty else { fail("Leere Zugangsdaten werden nicht gespeichert") }

    let attributes: [String: Any] = [
        kSecValueData as String: secret,
        kSecAttrAccessible as String: accessibility == "device-only"
            ? kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            : kSecAttrAccessibleAfterFirstUnlock,
    ]
    let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecItemNotFound {
        var insert = baseQuery
        for (key, value) in attributes { insert[key] = value }
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            fail("Zugangsdaten konnten nicht gespeichert werden", status: addStatus)
        }
    } else if updateStatus != errSecSuccess {
        fail("Zugangsdaten konnten nicht aktualisiert werden", status: updateStatus)
    }

case "load":
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { exit(0) }
    guard status == errSecSuccess, let data = result as? Data else {
        fail("Zugangsdaten konnten nicht gelesen werden", status: status)
    }
    FileHandle.standardOutput.write(data)

case "delete":
    let status = SecItemDelete(baseQuery as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        fail("Zugangsdaten konnten nicht gelöscht werden", status: status)
    }

default:
    fail("Unbekannte Schlüsselbundaktion")
}
