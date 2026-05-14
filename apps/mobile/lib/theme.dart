import 'package:flutter/material.dart';

// Palette mirrors apps/web/app/globals.css so the iOS app and the web
// dashboard feel like the same product.

class AppPalette {
  AppPalette._();

  static const Color lightBg = Color(0xFFF8F9FB);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightBorder = Color(0xFFE5E7EB);
  static const Color lightMuted = Color(0xFF6B7280);
  static const Color lightText = Color(0xFF111827);
  static const Color lightAccent = Color(0xFF3B82F6);

  static const Color darkBg = Color(0xFF0C0E12);
  static const Color darkSurface = Color(0xFF181B21);
  static const Color darkBorder = Color(0xFF272A31);
  static const Color darkMuted = Color(0xFF949CA8);
  static const Color darkText = Color(0xFFE8ECF4);
  static const Color darkAccent = Color(0xFF60A5FA);

  static const Color positive = Color(0xFF10B981);
  static const Color negative = Color(0xFFEF4444);
}

class AppTheme {
  AppTheme._();

  static ThemeData light() {
    final base = ThemeData.light(useMaterial3: true);
    return base.copyWith(
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppPalette.lightAccent,
        brightness: Brightness.light,
        surface: AppPalette.lightSurface,
        primary: AppPalette.lightAccent,
        secondary: AppPalette.positive,
        error: AppPalette.negative,
      ),
      scaffoldBackgroundColor: AppPalette.lightBg,
      cardTheme: const CardThemeData(
        elevation: 0,
        color: AppPalette.lightSurface,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
          side: BorderSide(color: AppPalette.lightBorder),
        ),
      ),
      dividerColor: AppPalette.lightBorder,
      textTheme: _textTheme(AppPalette.lightText, AppPalette.lightMuted),
      iconTheme: const IconThemeData(color: AppPalette.lightMuted),
      inputDecorationTheme: _inputTheme(AppPalette.lightBorder, AppPalette.lightMuted),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppPalette.lightBg,
        foregroundColor: AppPalette.lightText,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppPalette.lightSurface,
        selectedItemColor: AppPalette.lightAccent,
        unselectedItemColor: AppPalette.lightMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }

  static ThemeData dark() {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppPalette.darkAccent,
        brightness: Brightness.dark,
        surface: AppPalette.darkSurface,
        primary: AppPalette.darkAccent,
        secondary: AppPalette.positive,
        error: AppPalette.negative,
      ),
      scaffoldBackgroundColor: AppPalette.darkBg,
      cardTheme: const CardThemeData(
        elevation: 0,
        color: AppPalette.darkSurface,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
          side: BorderSide(color: AppPalette.darkBorder),
        ),
      ),
      dividerColor: AppPalette.darkBorder,
      textTheme: _textTheme(AppPalette.darkText, AppPalette.darkMuted),
      iconTheme: const IconThemeData(color: AppPalette.darkMuted),
      inputDecorationTheme: _inputTheme(AppPalette.darkBorder, AppPalette.darkMuted),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppPalette.darkBg,
        foregroundColor: AppPalette.darkText,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppPalette.darkSurface,
        selectedItemColor: AppPalette.darkAccent,
        unselectedItemColor: AppPalette.darkMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }

  static TextTheme _textTheme(Color text, Color muted) {
    const fontFamilyFallback = ['system-ui', '-apple-system', 'Helvetica Neue'];
    return TextTheme(
      displaySmall: TextStyle(
        color: text,
        fontSize: 28,
        fontWeight: FontWeight.w600,
        fontFamilyFallback: fontFamilyFallback,
      ),
      headlineMedium: TextStyle(
        color: text,
        fontSize: 22,
        fontWeight: FontWeight.w600,
        fontFamilyFallback: fontFamilyFallback,
      ),
      titleLarge: TextStyle(
        color: text,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        fontFamilyFallback: fontFamilyFallback,
      ),
      titleMedium: TextStyle(
        color: text,
        fontSize: 15,
        fontWeight: FontWeight.w500,
        fontFamilyFallback: fontFamilyFallback,
      ),
      bodyLarge: TextStyle(
        color: text,
        fontSize: 15,
        fontFamilyFallback: fontFamilyFallback,
      ),
      bodyMedium: TextStyle(
        color: text,
        fontSize: 14,
        fontFamilyFallback: fontFamilyFallback,
      ),
      bodySmall: TextStyle(
        color: muted,
        fontSize: 12,
        fontFamilyFallback: fontFamilyFallback,
      ),
      labelSmall: TextStyle(
        color: muted,
        fontSize: 11,
        fontFamilyFallback: fontFamilyFallback,
      ),
    );
  }

  static InputDecorationTheme _inputTheme(Color border, Color muted) {
    return InputDecorationTheme(
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      hintStyle: TextStyle(color: muted),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppPalette.lightAccent, width: 1.5),
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: border),
      ),
    );
  }
}

extension MoneyControlColors on BuildContext {
  Color get mutedText => Theme.of(this).brightness == Brightness.dark
      ? AppPalette.darkMuted
      : AppPalette.lightMuted;
  Color get borderColor => Theme.of(this).brightness == Brightness.dark
      ? AppPalette.darkBorder
      : AppPalette.lightBorder;
  Color get accentColor => Theme.of(this).brightness == Brightness.dark
      ? AppPalette.darkAccent
      : AppPalette.lightAccent;
}
