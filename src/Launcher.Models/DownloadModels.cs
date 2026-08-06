namespace Launcher.Models;

/// <summary>A single file to download by the download manager.</summary>
public sealed class DownloadItem
{
    public string Url { get; set; } = "";
    public string DestinationPath { get; set; } = "";
    public string? Sha1 { get; set; }
    public string? Sha256 { get; set; }
    public string? Sha512 { get; set; }
    public long Size { get; set; }
    public string? Label { get; set; }
    public bool Resume { get; set; } = true;
}

/// <summary>Progress callback data for a single file.</summary>
public sealed class DownloadProgress
{
    public string Label { get; set; } = "";
    public long BytesDownloaded { get; set; }
    public long TotalBytes { get; set; }
    public double SpeedBytesPerSecond { get; set; }

    public double Fraction => TotalBytes > 0 ? Math.Min(1.0, (double)BytesDownloaded / TotalBytes) : 0;
}

/// <summary>Aggregate progress callback data for a batch of files.</summary>
public sealed class BatchProgress
{
    public int CompletedFiles { get; set; }
    public int TotalFiles { get; set; }
    public long BytesDownloaded { get; set; }
    public long TotalBytes { get; set; }
    public double SpeedBytesPerSecond { get; set; }
    public string? CurrentFile { get; set; }

    public double Fraction => TotalBytes > 0 ? Math.Min(1.0, (double)BytesDownloaded / TotalBytes) : 0;
}

/// <summary>Outcome of a single download.</summary>
public sealed class DownloadResult
{
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public long BytesDownloaded { get; set; }
    public string? DestinationPath { get; set; }
    public bool Verified { get; set; }
}

/// <summary>Outcome of a batch download.</summary>
public sealed class BatchResult
{
    public int Succeeded { get; set; }
    public int Failed { get; set; }
    public List<string> FailedUrls { get; set; } = new();

    public bool AllSucceeded => Failed == 0;
}
