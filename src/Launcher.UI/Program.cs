using System;

namespace Launcher.UI;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var app = new App();
        app.InitializeComponent();
        app.Run();
    }
}
