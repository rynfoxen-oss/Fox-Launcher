namespace Launcher.Models;

/// <summary>
/// Type of an account. <see cref="Microsoft"/> accounts are authenticated
/// through the official Microsoft/Mojang OAuth flow; <see cref="Offline"/>
/// accounts are local, unverified profiles.
/// </summary>
public enum AccountType
{
    /// <summary>Authenticated Microsoft account.</summary>
    Microsoft,

    /// <summary>Local offline profile (no authentication).</summary>
    Offline
}
