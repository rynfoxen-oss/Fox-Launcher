using System;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Input;
using Launcher.Services;

namespace Launcher.UI;

/// <summary>
/// Shows a parsed Minecraft crash report: diagnosis, fix hint, summary and the
/// raw stack trace, with a button to open the report file itself.
/// </summary>
public partial class CrashReportDialog : Window
{
    private readonly CrashAnalysis _analysis;

    public CrashReportDialog(CrashAnalysis analysis)
    {
        _analysis = analysis;
        InitializeComponent();

        SubtitleText.Text = $"The game stopped with an error (report saved).";
        SummaryText.Text = string.IsNullOrWhiteSpace(analysis.Summary)
            ? "No description in the report."
            : analysis.Summary;
        DiagnosisText.Text = string.IsNullOrWhiteSpace(analysis.Diagnosis)
            ? "The game crashed."
            : analysis.Diagnosis;
        FixHintText.Text = analysis.FixHint;
        StackText.Text = BuildDetails(analysis);
        OpenReportButton.IsEnabled = File.Exists(analysis.ReportPath);
    }

    private static string BuildDetails(CrashAnalysis analysis)
    {
        var sb = new StringBuilder();
        if (!string.IsNullOrEmpty(analysis.Title))
        {
            sb.AppendLine($"Report title : {analysis.Title}");
        }
        if (analysis.ActiveMods.Count > 0)
        {
            sb.AppendLine("Active mods  :");
            foreach (var mod in analysis.ActiveMods) sb.AppendLine($"  {mod}");
            sb.AppendLine();
        }
        sb.AppendLine("Stack trace:");
        if (analysis.StackTrace.Count > 0)
        {
            foreach (var line in analysis.StackTrace) sb.AppendLine(line);
        }
        else
        {
            sb.AppendLine("  (none captured)");
        }
        return sb.ToString();
    }

    private void OnOpenReportClick(object sender, RoutedEventArgs e)
    {
        if (File.Exists(_analysis.ReportPath))
        {
            Launcher.Utils.ProcessHelper.Open(_analysis.ReportPath);
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void OnTitleMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }
}
