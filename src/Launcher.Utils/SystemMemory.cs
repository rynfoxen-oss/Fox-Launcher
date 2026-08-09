using System.Runtime.InteropServices;

namespace Launcher.Utils;

/// <summary>
/// Physical system memory information, queried once per process (the value does
/// not change at runtime in practice). Used to cap the memory sliders and
/// recommend a safe maximum for the game so the whole machine is never starved.
/// </summary>
public static class SystemMemory
{
    private static readonly long TotalPhysicalBytes = ReadTotalBytes();

    /// <summary>Total physical RAM in megabytes (0 when it cannot be determined).</summary>
    public static int TotalPhysicalMb => (int)(TotalPhysicalBytes / (1024L * 1024L));

    /// <summary>
    /// Absolute cap for the maximum heap slider. Never allow a value above the
    /// machine's RAM, but always keep at least 2048 MB so small machines can
    /// still launch, and never go beyond 32768 MB.
    /// </summary>
    public static int HardMaxMb =>
        Math.Min(32768, Math.Max(2048, RoundDown(TotalPhysicalMb, 512)));

    /// <summary>
    /// Recommended maximum heap: roughly half of physical RAM rounded to the
    /// nearest 1 GB step, leaving the rest for Windows and the launcher.
    /// </summary>
    public static int RecommendedMaxMb =>
        Math.Max(1024, (int)(Math.Round(TotalPhysicalMb * 0.5 / 1024.0) * 1024));

    /// <summary>Formats megabytes as whole gigabytes, e.g. 16384 → "16 GB".</summary>
    public static string FormatGb(int mb) => (mb / 1024) + " GB";

    private static int RoundDown(int value, int step) => value - (value % step);

    private static long ReadTotalBytes()
    {
        if (!OperatingSystem.IsWindows()) return 8L * 1024 * 1024 * 1024;
        try
        {
            var status = new MemoryStatusEx { dwLength = (uint)Marshal.SizeOf<MemoryStatusEx>() };
            if (GlobalMemoryStatusEx(ref status)) return (long)status.ullTotalPhys;
        }
        catch
        {
            // Fall through; a 0 total is handled by the callers' floors.
        }
        return 0;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx lpBuffer);
}
