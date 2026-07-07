// qrcode 套件未附型別，僅宣告本專案用到的介面
declare module 'qrcode' {
    const QRCode: {
        toDataURL(text: string, options?: { width?: number; margin?: number }): Promise<string>;
    };
    export default QRCode;
}
