import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Image, ActivityIndicator, NetInfo, Platform } from 'react-native';
import RNFS, { DocumentDirectoryPath } from 'react-native-fs';
import ResponsiveImage from 'react-native-responsive-image';

const SHA1 = require("crypto-js/sha1");
const URL = require('url-parse');

class CacheableImage extends Component {
    constructor(props) {
        super(props)
        this.imageDownloadBegin = this.imageDownloadBegin.bind(this);
        this.imageDownloadProgress = this.imageDownloadProgress.bind(this);
        this._stopDownload = this._stopDownload.bind(this);
        this.checkImageCache = this.checkImageCache.bind(this);
        this._processSource = this._processSource.bind(this);
        this._deleteFilePath = this._deleteFilePath.bind(this);
        this.renderCache = this.renderCache.bind(this);
        this.renderLocal = this.renderLocal.bind(this);
        this.renderDefaultSource = this.renderDefaultSource.bind(this);

        this.state = {
            isRemote: false,
            cachedImagePath: null,
            cacheable: true,
            downloading: false,
            jobId: null
        };
    };

    shouldComponentUpdate(nextProps, nextState) {
        if (nextState === this.state && nextProps === this.props) {
            return false;
        }
        return true;
    }

    async imageDownloadBegin(info) {
        switch (info.statusCode) {
            case 404:
            case 403:
                break;
            default:
                // this.downloading = true;
                // this.jobId = info.jobId;
                this.setState({ downloading: true, jobId: info.jobId });
        }
    }

    async imageDownloadProgress(info) {
        if ((info.contentLength / info.bytesWritten) == 1) {
            // this.downloading = false;
            // this.jobId = null;
            this.setState({ downloading: false, jobId: null });
        }
    }

    async checkImageCache(imageUri, cachePath, cacheKey) {
        const { bundleIdentifier } = this.props;
        const pathArr = DocumentDirectoryPath.split('/');
        pathArr.pop();
        const dirPath = pathArr.join('/') + '/Library/Caches/' + bundleIdentifier + '/' + cachePath;
        const filePath = dirPath + '/' + cacheKey;

        RNFS
        .stat(filePath)
        .then((res) => {
            if (res.isFile() && res.size > 0) {
                // It's possible the component has already unmounted before setState could be called.
                // It happens when the defaultSource and source have both been cached.
                // An attempt is made to display the default however it's instantly removed since source is available

                // means file exists, ie, cache-hit
                this.setState({cacheable: true, cachedImagePath: filePath});
            }
            else {
                throw Error("CacheableImage: Invalid file in checkImageCache()");
            }
        })
        .catch((err) => {

            // means file does not exist

            // then make sure directory exists.. then begin download
            // The NSURLIsExcludedFromBackupKey property can be provided to set this attribute on iOS platforms.
            // Apple will reject apps for storing offline cache data that does not have this attribute.
            // https://github.com/johanneslumpe/react-native-fs#mkdirfilepath-string-options-mkdiroptions-promisevoid
            RNFS
            .mkdir(dirPath, {NSURLIsExcludedFromBackupKey: true})
            .then(() => {
                // before we change the cachedImagePath.. if the previous cachedImagePath was set.. remove it
                if (this.state.cacheable && this.state.cachedImagePath) {
                    let delImagePath = this.state.cachedImagePath;
                    this._deleteFilePath(delImagePath);
                }

                // If already downloading, cancel the job
                if (this.state.jobId) {
                    this._stopDownload();
                }

                let downloadOptions = {
                    fromUrl: imageUri,
                    toFile: filePath,
                    background: this.props.downloadInBackground,
                    begin: this.imageDownloadBegin,
                    progress: this.imageDownloadProgress
                };

                // directory exists.. begin download
                let download = RNFS
                .downloadFile(downloadOptions);

                // this.downloading = true;
                // this.jobId = download.jobId;

                this.setState({ downloading: true, jobId: download.jobId });

                download.promise
                .then((res) => {
                    // this.downloading = false;
                    // this.jobId = null;
                    this.setState({ downloading: false, jobId: null });

                    switch (res.statusCode) {
                        case 404:
                        case 403:
                            this.setState({cacheable: false, cachedImagePath: null});
                            break;
                        default:
                            this.setState({cacheable: true, cachedImagePath: filePath});
                    }
                })
                .catch((err) => {
                    // error occurred while downloading or download stopped.. remove file if created
                    this._deleteFilePath(filePath);

                    // If there was no in-progress job, it may have been cancelled already (and this component may be unmounted)
                    if (this.state.downloading) {
                        // this.downloading = false;
                        // this.jobId = null;
                        this.setState({cacheable: false, cachedImagePath: null, downloading: false, jobId: null});
                    }
                });
            })
            .catch((err) => {
                this._deleteFilePath(filePath);
                this.setState({cacheable: false, cachedImagePath: null});
            });
        });
    }

    _deleteFilePath(filePath) {
        RNFS
        .exists(filePath)
        .then((res) => {
            if (res) {
                RNFS
                .unlink(filePath)
                .catch((err) => {});
            }
        });
    }

    _processSource(source, skipSourceCheck) {

        if (source !== null
            && source != ''
            && typeof source === "object"
            && source.hasOwnProperty('uri')
            && (
                skipSourceCheck ||
                typeof skipSourceCheck === 'undefined' ||
                (!skipSourceCheck && source != this.props.source)
           )
        )
        { // remote

            if (this.state.jobId) { // sanity
                this._stopDownload();
            }

            const url = new URL(source.uri, null, true);

            // handle query params for cache key
            let cacheable = url.pathname;
            if (Array.isArray(this.props.useQueryParamsInCacheKey)) {
                this.props.useQueryParamsInCacheKey.forEach(function(k) {
                    if (url.query.hasOwnProperty(k)) {
                        cacheable = cacheable.concat(url.query[k]);
                    }
                });
            }
            else if (this.props.useQueryParamsInCacheKey) {
                cacheable = cacheable.concat(url.query);
            }

            const type = url.pathname.replace(/.*\.(.*)/, '$1');
            const cacheKey = SHA1(cacheable) + (type.length < url.pathname.length ? '.' + type : '');

            this.checkImageCache(source.uri, url.host, cacheKey);
            this.setState({isRemote: true});
        } else {
            this.setState({isRemote: false});
        }
    }

    _stopDownload() {
        if (!this.state.jobId) return;

        // this.downloading = false;
        RNFS.stopDownload(this.state.jobId);
        // this.jobId = null;
        this.setState({downloading: false, jobId: null});
    }

    componentWillMount() {
        this._processSource(this.props.source, true);
    }

    componentWillUnmount() {
        if (this.state.downloading && this.state.jobId) {
            this._stopDownload();
        }
    }

    render() {
        if (!this.state.isRemote && !this.props.defaultSource) {
            return this.renderLocal();
        }

        if (this.state.cacheable && this.state.cachedImagePath) {
            return this.renderCache();
        }

        if (this.props.defaultSource) {
            return this.renderDefaultSource();
        }

        return (
            <ActivityIndicator {...this.props.activityIndicatorProps} />
        );

        return null;
    }

    renderCache() {
        const { children, defaultSource, downloadInBackground, activityIndicatorProps, ...props } = this.props;
        return (
            <ResponsiveImage {...props} source={{uri: 'file://'+this.state.cachedImagePath}}>
            {children}
            </ResponsiveImage>
        );
    }

    renderLocal() {
        const { children, defaultSource, downloadInBackground, activityIndicatorProps, ...props } = this.props;
        return (
            <ResponsiveImage {...props}>
            {children}
            </ResponsiveImage>
        );
    }

    renderDefaultSource() {
        const { children, defaultSource, ...props } = this.props;
        return (
            <CacheableImage {...props} source={defaultSource} >
            {children}
            </CacheableImage>
        );
    }
}

CacheableImage.propTypes = {
    activityIndicatorProps: PropTypes.object,
    defaultSource: Image.propTypes.source,
    useQueryParamsInCacheKey: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.array
    ]),
    checkNetwork: PropTypes.bool,
    networkAvailable: PropTypes.bool,
    downloadInBackground: PropTypes.bool,
    bundleIdentifier: PropTypes.string.isRequired,
};

CacheableImage.defaultProps = {
    style: { backgroundColor: 'transparent' },
    activityIndicatorProps: {
        style: { backgroundColor: 'transparent', flex: 1 }
    },
    useQueryParamsInCacheKey: false, // bc
    checkNetwork: true,
    networkAvailable: false,
    downloadInBackground: (Platform.OS === 'ios') ? false : true
};

export default CacheableImage;
