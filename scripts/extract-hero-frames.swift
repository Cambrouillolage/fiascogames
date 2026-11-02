#!/usr/bin/env swift
// Extrait la séquence de frames du hero GAV (scroll-scrubbing sur <canvas>)
// à partir de la vidéo source, via AVFoundation — pas besoin d'ffmpeg.
//
// Les 90 frames déjà commitées dans assets/hero-frames/hero-frame-001.jpg
// ... hero-frame-090.jpg ont été produites ainsi, à partir de
// assets/boite_jeu_interrogatoire_360_1080p.mp4. Ne relancer que si la
// vidéo source est re-tournée/re-exportée.
//
// Usage : swift scripts/extract-hero-frames.swift <source.mp4> assets/hero-frames 90

import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 4 else {
    print("Usage: extract-hero-frames.swift <input.mp4> <outputDir> <frameCount>")
    exit(1)
}
let inputPath = args[1]
let outputDir = args[2]
let frameCount = Int(args[3]) ?? 90

let asset = AVURLAsset(url: URL(fileURLWithPath: inputPath))
let durationSeconds = CMTimeGetSeconds(asset.duration)
print("duration: \(durationSeconds)s, extracting \(frameCount) frames")

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let fm = FileManager.default
try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

for i in 0..<frameCount {
    // Frames réparties uniformément sur toute la durée (pas liées au fps
    // natif de la source), donc frame 1 = tout début, frame N = tout fin.
    let t = durationSeconds * Double(i) / Double(frameCount - 1)
    let time = CMTime(seconds: t, preferredTimescale: 600)
    do {
        let cgImage = try generator.copyCGImage(at: time, actualTime: nil)
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else {
            print("no data for frame \(i)")
            continue
        }
        let filename = outputDir + "/" + String(format: "hero-frame-%03d.jpg", i + 1)
        try data.write(to: URL(fileURLWithPath: filename))
    } catch {
        print("error at frame \(i): \(error)")
    }
}
print("done")
