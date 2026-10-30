// 用 macOS 自带的 PDFKit 提取 PDF 文字，每页以 "=== PDF p.N ===" 开头。
// 编译：swiftc -O pdftext.swift -o mba-pdftext
// 用法：mba-pdftext 文件.pdf > 输出.txt
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 2, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    print("CANNOT_OPEN")
    exit(1)
}
for i in 0..<doc.pageCount {
    print("=== PDF p.\(i + 1) ===")
    print(doc.page(at: i)?.string ?? "")
}
