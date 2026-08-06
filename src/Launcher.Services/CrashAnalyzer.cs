using System.Text.RegularExpressions;
using Launcher.Models;

namespace Launcher.Services;

/// <summary>
/// Best-effort crash report parser. Extracts the cause, affected version and
/// active mods from Minecraft crash reports and produces a human-friendly
/// diagnosis.
/// </summary>
public sealed class CrashAnalyzer
{
    /// <summary>Parses a crash report file into a <see cref="CrashAnalysis"/>.</summary>
    public CrashAnalysis Analyze(string crashReportPath)
    {
        var analysis = new CrashAnalysis { ReportPath = crashReportPath };
        try
        {
            if (!File.Exists(crashReportPath))
            {
                analysis.Summary = "Crash report file was not found.";
                return analysis;
            }

            var lines = File.ReadAllLines(crashReportPath);
            var title = lines.FirstOrDefault(l => l.StartsWith("---- Minecraft Crash Report")) ?? "";
            analysis.Title = title.Length > title.IndexOf("//", StringComparison.Ordinal)
                ? title[(title.IndexOf("//", StringComparison.Ordinal) + 2)..].Trim()
                : title;

            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i];
                if (line.StartsWith("Description:"))
                {
                    analysis.Summary = lines.Length > i + 1 ? lines[i + 1].Trim() : "";
                }
                else if (line.StartsWith("java.lang.") || line.StartsWith("Caused by:") || line.StartsWith("at net.minecraft"))
                {
                    analysis.StackTrace.Add(line.Trim());
                }
                else if (line.StartsWith("    A detailed walkthrough") )
                {
                    analysis.Walkthrough = string.Join(Environment.NewLine,
                        lines.Skip(i).TakeWhile(l => !string.IsNullOrWhiteSpace(l)));
                }
            }

            // Extract mod list if present.
            var mods = lines
                .Where(l => l.Contains("|") && (l.Contains("mod") || l.Contains("fml")))
                .Select(l => l.Trim())
                .Where(l => !l.StartsWith("|--"))
                .ToList();
            analysis.ActiveMods = mods.Where(m => !m.Contains("|    |") && !m.Contains("==")).ToList();

            // Known-problem heuristics.
            if (analysis.Summary.Contains("OutOfMemoryError", StringComparison.OrdinalIgnoreCase) ||
                lines.Any(l => l.Contains("OutOfMemoryError")))
            {
                analysis.Diagnosis = "The game ran out of memory. Increase the allocated RAM in Settings.";
                analysis.FixHint = "Raise the memory slider (e.g. to 4 GB or higher) before launching again.";
            }
            else if (lines.Any(l => l.Contains("Couldn't load model") || l.Contains("Tesselating")))
            {
                analysis.Diagnosis = "A rendering error occurred, often caused by an incompatible mod or shader pack.";
                analysis.FixHint = "Disable recently added mods or shader packs and try again.";
            }
            else if (lines.Any(l => l.Contains("NoSuchMethodError") || l.Contains("NoClassDefFoundError") || l.Contains("ClassCastException")))
            {
                analysis.Diagnosis = "A mod is incompatible with the current loader or game version.";
                analysis.FixHint = "Update or remove the offending mod, or switch the instance to a matching loader version.";
            }
            else if (lines.Any(l => l.Contains("GLFW error") || l.Contains("lwjgl")))
            {
                analysis.Diagnosis = "The game could not initialize its graphics window.";
                analysis.FixHint = "Update your GPU drivers, or try lowering the resolution and disabling fullscreen.";
            }
            else
            {
                analysis.Diagnosis = "The game crashed for an unexpected reason. Review the stack trace below.";
                analysis.FixHint = "If the crash repeats, disable mods one by one and check the launcher logs.";
            }
        }
        catch (Exception ex)
        {
            analysis.Summary = $"Could not read crash report: {ex.Message}";
            analysis.Diagnosis = "Unable to parse the crash report.";
        }
        return analysis;
    }
}

/// <summary>Result of parsing a crash report.</summary>
public sealed class CrashAnalysis
{
    public string ReportPath { get; set; } = "";
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string Walkthrough { get; set; } = "";
    public string Diagnosis { get; set; } = "";
    public string FixHint { get; set; } = "";
    public List<string> StackTrace { get; set; } = new();
    public List<string> ActiveMods { get; set; } = new();
}
